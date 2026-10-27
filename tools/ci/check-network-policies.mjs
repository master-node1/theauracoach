#!/usr/bin/env node
// Checks the rendered Helm output (tools/ci/helm-validate.sh) against the service catalog:
//   1. global.callGraph in infra/helm/values/common.yaml has exactly the arrows of service catalog §4.
//   2. Every rendered NetworkPolicy admits exactly the catalog's callers and reaches exactly its callees,
//      in the right namespaces, for every environment and both hosting stages.
//   3. INTERNAL_SERVICE_URLS and the gateway's upstreams name the same callees.
//   4. Every NestJS service has a migration hook and http probes; only api-gateway and web are exposed.
//   5. No values file under infra/helm holds a secret.
// Usage: check-network-policies.mjs <json-dir>, laid out by helm-validate.sh (renders as JSON lines).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: check-network-policies.mjs <json-dir>');

const failures = [];
const fail = (msg) => failures.push(msg);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const show = (xs) => `[${[...xs].sort().join(', ')}]`;

// --- 1. Catalog §4 arrows vs global.callGraph -------------------------------------------------
const catalog = readFileSync('docs/architecture/service-catalog.md', 'utf8');
const section = catalog.split('## 4. Allowed synchronous dependencies')[1]?.split('\n## ')[0];
const mermaid = section?.match(/```mermaid\n([\s\S]*?)```/)?.[1];
if (!mermaid) throw new Error('service catalog §4 mermaid diagram not found');
const alias = {};
const edges = [];
for (const line of mermaid.split('\n')) {
  for (const m of line.matchAll(/(\w+)\[([^\]]+)\]/g)) alias[m[1]] = m[2].trim();
  const e = /^\s*(\w+)(?:\[[^\]]*\])?\s*-->(?:\|[^|]*\|)?\s*(\w+)/.exec(line);
  if (e) edges.push([e[1], e[2]]);
}
const catalogEdges = edges.map(([a, b]) => `${alias[a] ?? a}->${alias[b] ?? b}`);

const common = JSON.parse(readFileSync(join(out, 'common.json'), 'utf8'));
const { callGraph, deployables } = common.global;
const graphEdges = Object.entries(callGraph).flatMap(([from, tos]) =>
  tos.map((to) => `${from}->${to}`),
);
if (!sameSet(catalogEdges, graphEdges)) {
  fail(
    `values/common.yaml callGraph differs from service catalog §4:\n` +
      `  only in catalog: ${show(catalogEdges.filter((e) => !graphEdges.includes(e)))}\n` +
      `  only in callGraph: ${show(graphEdges.filter((e) => !catalogEdges.includes(e)))}`,
  );
}
for (const name of new Set(graphEdges.flatMap((e) => e.split('->')))) {
  if (!deployables[name]) fail(`callGraph names ${name}, which is not in global.deployables`);
}
const callersOf = (d) => Object.keys(callGraph).filter((c) => callGraph[c].includes(d));
const calleesOf = (d) => callGraph[d] ?? [];

// --- 2-4. Rendered manifests -------------------------------------------------------------------
const readDocs = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && l.trim() !== 'null')
    .map((l) => JSON.parse(l));

let checked = 0;
for (const stage of ['k3s', 'eks']) {
  for (const file of readdirSync(join(out, stage))) {
    const [env, ...rest] = file.replace(/\.json$/, '').split('-');
    const d = rest.join('-');
    const where = `${stage}/${env}/${d}`;
    const docs = readDocs(join(out, stage, file));
    const find = (kind, name) => docs.find((x) => x.kind === kind && x.metadata.name === name);
    const prefix = env === 'prod' ? '' : `${env}-`;
    const nsOf = (name) => `${prefix}aura-${deployables[name].tier}`;
    const peers = (list) =>
      (list ?? [])
        .filter((p) => p.podSelector?.matchLabels?.['app.kubernetes.io/name'] in deployables)
        .map((p) => {
          const name = p.podSelector.matchLabels['app.kubernetes.io/name'];
          const ns = p.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'];
          if (ns !== nsOf(name))
            fail(`${where}: peer ${name} expected in namespace ${nsOf(name)}, got ${ns}`);
          return name;
        });

    const ingress = find('NetworkPolicy', `${d}-ingress`);
    const egress = find('NetworkPolicy', `${d}-egress`);
    if (!ingress || !egress) {
      fail(`${where}: missing ${d}-ingress or ${d}-egress NetworkPolicy`);
      continue;
    }
    const from = (ingress.spec.ingress ?? []).flatMap((r) => r.from ?? []);
    const allowedFrom = peers(from);
    if (!sameSet(allowedFrom, callersOf(d))) {
      fail(
        `${where}: ingress admits ${show(allowedFrom)}, catalog callers are ${show(callersOf(d))}`,
      );
    }
    const exposed = ['api-gateway', 'web'].includes(d);
    const fromController = from.some(
      (p) => p.podSelector?.matchLabels?.['app.kubernetes.io/name'] === 'traefik',
    );
    if (fromController !== exposed)
      fail(`${where}: ingress-controller access is ${fromController}, expected ${exposed}`);

    const to = (egress.spec.egress ?? []).flatMap((r) => r.to ?? []);
    const reaches = peers(to);
    if (!sameSet(reaches, calleesOf(d))) {
      fail(`${where}: egress reaches ${show(reaches)}, catalog callees are ${show(calleesOf(d))}`);
    }

    const config = find('ConfigMap', `${d}-env`)?.data ?? {};
    if ('SERVICE_NAME' in config) {
      const urls = (config.INTERNAL_SERVICE_URLS ?? '')
        .split(',')
        .filter(Boolean)
        .map((p) => p.split('=')[0]);
      if (!sameSet(urls, calleesOf(d)))
        fail(`${where}: INTERNAL_SERVICE_URLS names ${show(urls)}, expected ${show(calleesOf(d))}`);
      const job = find('Job', `${d}-migrate`);
      if (!job?.metadata.annotations?.['helm.sh/hook']?.includes('pre-upgrade'))
        fail(`${where}: no pre-upgrade migration Job`);
    }
    if (d === 'api-gateway') {
      const upstreams = Object.keys(config).filter((k) => k.endsWith('_UPSTREAM'));
      if (upstreams.length !== calleesOf(d).length)
        fail(`${where}: ${upstreams.length} upstreams, expected ${calleesOf(d).length}`);
    }

    const http = find('Deployment', `${d}-http`);
    const container = http?.spec.template.spec.containers[0];
    if (!container?.readinessProbe || !container?.livenessProbe)
      fail(`${where}: http deployment lacks probes`);

    const routes = docs.filter((x) => x.kind === 'IngressRoute' || x.kind === 'Ingress');
    if (exposed !== routes.length > 0)
      fail(`${where}: ${routes.length} ingress objects, exposed=${exposed}`);
    checked++;
  }
}
if (checked === 0) fail('no rendered releases found');

// --- 5. No secrets in values files -------------------------------------------------------------
const secretKey =
  /(password|passwd|token|api[-_]?key|private[-_]?key|client[-_]?secret)$|^secret$/i;
for (const file of readdirSync(join(out, 'values'))) {
  const isCiInput = file.startsWith('ci--');
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const p = path ? `${path}.${k}` : k;
        if (typeof v === 'string' && v && secretKey.test(k))
          fail(`${file}: ${p} looks like a secret value`);
        if (p.endsWith('originVerify.value') && v && !isCiInput)
          fail(`${file}: ${p} must be a deploy input, not a value`);
        walk(v, p);
      }
      return;
    }
    if (typeof node !== 'string') return;
    if (/:\/\/[^/\s:@]+:[^/\s@]+@/.test(node)) fail(`${file}: ${path} has credentials in a URL`);
    if (/AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(node))
      fail(`${file}: ${path} holds a key`);
  };
  for (const doc of readDocs(join(out, 'values', file))) walk(doc, '');
}

if (failures.length) {
  console.error(`${failures.length} problem(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `ok: ${catalogEdges.length} catalog arrows, ${checked} rendered releases checked, values hold no secrets`,
);
