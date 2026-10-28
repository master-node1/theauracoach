#!/usr/bin/env node
// Checks that CloudFront, the ingress routes and the origin certificate agree on the hosts each
// environment answers on (deployment.md "Edge routing", TAC-46). CloudFront forwards the viewer Host,
// so the node sees app.<env>. and api.<env>., never origin.<domain>:
//   1. Every CloudFront behavior to the k3s origin forwards the viewer Host and adds
//      CloudFront-Viewer-Address, the address web and the gateway rate-limit on (modules/edge), and each
//      account stack feeds the distribution and helm_inputs.public_hosts from the same map.
//   2. For dev, staging and prod, starting from example `terraform output -json` files run through
//      tools/deploy/deploy-inputs.mjs (as the deploy job does): web routes only the web host and
//      api-gateway only the api host (k3s IngressRoute and EKS Ingress), both on the CloudFront
//      distribution, and the origin certificate in the same namespace covers exactly those hosts.
//   3. No environment routes or certifies a host of another (dev and staging share the non-prod node).
// Usage: check-edge-routing.mjs. Needs helm and yq (mikefarah, v4); never talks to a cluster.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployInputs } from '../deploy/deploy-inputs.mjs';

const ENV_ACCOUNT = { dev: 'nonprod', staging: 'nonprod', prod: 'prod' };
const TAG = '0'.repeat(40);
const K8S_VERSION = process.env.K8S_VERSION ?? '1.36.0';
const failures = [];
const fail = (msg) => failures.push(msg);
const show = (xs) => `[${[...xs].sort().join(', ')}]`;
const sameSet = (a, b) => a.length === b.length && show(a) === show(b);

// --- 1. CloudFront forwards the viewer Host and address ---------------------------------------------------
/** Bodies of the top-level `name {` blocks inside an HCL text, by brace matching. */
function blocks(text, name) {
  const found = [];
  for (const m of text.matchAll(new RegExp(`^\\s*${name}\\s*\\{`, 'gm'))) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) {
        found.push(text.slice(m.index + m[0].length, i));
        break;
      }
    }
  }
  return found;
}
const attr = (body, key) => new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(#.*)?$`, 'm').exec(body)?.[1];

const edge = readFileSync('infra/terraform/modules/edge/main.tf', 'utf8');
const [policy] = blocks(edge, 'resource "aws_cloudfront_origin_request_policy" "k3s"');
const [headersConfig] = blocks(policy ?? '', 'headers_config');
if (
  attr(headersConfig ?? '', 'header_behavior') !== '"allViewerAndWhitelistCloudFront"' ||
  !/"CloudFront-Viewer-Address"/.test(headersConfig)
) {
  fail(
    'modules/edge: origin request policy k3s must forward all viewer headers (Host) plus CloudFront-Viewer-Address',
  );
}
const [distribution] = blocks(edge, 'resource "aws_cloudfront_distribution" "this"');
if (!distribution) throw new Error('modules/edge: aws_cloudfront_distribution.this not found');
const traefik = blocks(distribution, 'origin').find(
  (o) => attr(o, 'origin_id') === 'local.traefik_origin_id',
);
if (attr(traefik ?? '', 'domain_name') !== 'var.origin_hostname') {
  fail('modules/edge: the k3s origin must connect to var.origin_hostname');
}
const behaviors = [
  ...blocks(distribution, 'default_cache_behavior'),
  ...blocks(distribution, 'ordered_cache_behavior'),
].filter((b) => attr(b, 'target_origin_id') === 'local.traefik_origin_id');
if (behaviors.length === 0) fail('modules/edge: no cache behavior targets the k3s origin');
for (const b of behaviors) {
  if (attr(b, 'origin_request_policy_id') !== 'aws_cloudfront_origin_request_policy.k3s.id') {
    fail(
      `modules/edge: behavior ${attr(b, 'path_pattern') ?? '(default)'} to the k3s origin does not use the k3s origin request policy (Host, viewer address)`,
    );
  }
}
for (const account of ['nonprod', 'prod']) {
  const main = readFileSync(`infra/terraform/envs/${account}/main.tf`, 'utf8');
  const outputs = readFileSync(`infra/terraform/envs/${account}/outputs.tf`, 'utf8');
  const [edgeModule] = blocks(main, 'module "edge"');
  if (attr(edgeModule ?? '', 'public_hosts') !== 'local.hosts') {
    fail(`envs/${account}: module.edge must take public_hosts = local.hosts`);
  }
  const [helmInputs] = blocks(outputs, 'output "helm_inputs"');
  if (attr(helmInputs ?? '', 'public_hosts') !== 'local.hosts') {
    fail(`envs/${account}: helm_inputs.public_hosts must be local.hosts`);
  }
}

// --- 2. Rendered routes and certificates per environment ---------------------------------------
const work = mkdtempSync(join(tmpdir(), 'edge-routing-'));
const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
const docs = (file) =>
  JSON.parse(run('yq', ['ea', '-o=json', '-I=0', '[.] | map(select(. != null))', file]));
const tfOutputs = (account) =>
  JSON.parse(readFileSync(`infra/helm/ci/terraform-outputs-${account}.json`, 'utf8'));

/** Hosts each rendered edge resource routes: { kind, namespace, deployable, hosts, tlsSecret }. */
function routes(file) {
  return docs(file).flatMap((d) => {
    const base = { kind: d.kind, namespace: d.metadata.namespace, deployable: d.metadata.name };
    if (d.kind === 'IngressRoute') {
      return d.spec.routes.map((r) => ({
        ...base,
        hosts: [...r.match.matchAll(/Host\(`([^`]+)`\)/g)].map((m) => m[1]),
        tlsSecret: d.spec.tls?.secretName,
      }));
    }
    if (d.kind === 'Ingress') return [{ ...base, hosts: d.spec.rules.map((r) => r.host) }];
    return [];
  });
}

const certificates = {}; // env -> { namespace, dnsNames, secretName }
const routed = {}; // env -> hosts
const platformRendered = new Set();
for (const [env, account] of Object.entries(ENV_ACCOUNT)) {
  const outputs = tfOutputs(account);
  const aliases = outputs.cloudfront_aliases.value;
  const { service, platform } = deployInputs(env, outputs, { acmeEmail: 'platform@example.test' });
  const inputs = join(work, `${env}-service-inputs.json`);
  writeFileSync(inputs, JSON.stringify(service));
  const expected = { web: service.global.hosts.web, 'api-gateway': service.global.hosts.api };
  const edgeNs = `${env === 'prod' ? '' : `${env}-`}aura-edge`;
  routed[env] = [];

  for (const stage of ['k3s', 'eks']) {
    const out = join(work, stage);
    run('tools/deploy/helm-deploy.sh', [env, TAG, inputs, 'api-gateway', 'web'], {
      DRY_RUN: '1',
      OUT: out,
      STAGE: stage,
      K8S_VERSION,
      ORIGIN_VERIFY: 'ci-placeholder-not-a-secret',
    });
    for (const [deployable, host] of Object.entries(expected)) {
      const found = routes(join(out, `${env}-${deployable}.yaml`));
      const want = stage === 'k3s' ? 'IngressRoute' : 'Ingress';
      if (found.length === 0 || found.some((r) => r.kind !== want)) {
        fail(`${env}/${stage}: ${deployable} renders no ${want}`);
      }
      for (const r of found) {
        routed[env].push(...r.hosts);
        if (!sameSet(r.hosts, [host]))
          fail(`${env}/${stage}: ${deployable} routes ${show(r.hosts)}, want [${host}]`);
        if (r.namespace !== edgeNs)
          fail(`${env}/${stage}: ${deployable} is in ${r.namespace}, want ${edgeNs}`);
        if (stage === 'k3s' && r.tlsSecret !== 'origin-tls') {
          fail(`${env}: ${deployable} uses TLS secret ${r.tlsSecret}, want origin-tls`);
        }
        for (const h of r.hosts) {
          if (!aliases.includes(h))
            fail(`${env}/${stage}: ${deployable} routes ${h}, not a CloudFront alias`);
        }
      }
    }
  }

  if (!platformRendered.has(account)) {
    platformRendered.add(account);
    const pin = join(work, `${account}-platform-inputs.json`);
    writeFileSync(pin, JSON.stringify(platform));
    const file = join(work, `${account}-platform.yaml`);
    writeFileSync(
      file,
      run('helm', [
        'template',
        'platform',
        'infra/helm/aura-platform',
        '--namespace',
        'aura-system',
        '--kube-version',
        K8S_VERSION,
        '-f',
        `infra/helm/aura-platform/values-${account}.yaml`,
        '-f',
        pin,
      ]),
    );
    for (const c of docs(file).filter((d) => d.kind === 'Certificate')) {
      const e = c.metadata.labels?.environment;
      certificates[e] = {
        namespace: c.metadata.namespace,
        dnsNames: c.spec.dnsNames,
        secretName: c.spec.secretName,
      };
    }
  }
}

for (const env of Object.keys(ENV_ACCOUNT)) {
  const cert = certificates[env];
  const edgeNs = `${env === 'prod' ? '' : `${env}-`}aura-edge`;
  const hosts = [...new Set(routed[env])];
  if (!cert) {
    fail(`${env}: aura-platform renders no origin certificate`);
    continue;
  }
  if (cert.namespace !== edgeNs || cert.secretName !== 'origin-tls') {
    fail(
      `${env}: origin certificate is ${cert.namespace}/${cert.secretName}, want ${edgeNs}/origin-tls`,
    );
  }
  if (!sameSet(cert.dnsNames, hosts)) {
    fail(`${env}: origin certificate covers ${show(cert.dnsNames)}, routes use ${show(hosts)}`);
  }
}

// --- 3. Environments never share a host --------------------------------------------------------
const envs = Object.keys(ENV_ACCOUNT);
for (const a of envs) {
  for (const b of envs) {
    if (a >= b) continue;
    const shared = [...new Set(routed[a])].filter(
      (h) => routed[b].includes(h) || certificates[b]?.dnsNames.includes(h),
    );
    if (shared.length) fail(`${a} and ${b} share ${show(shared)}`);
  }
}

if (failures.length) {
  console.error(`edge routing: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
for (const env of envs)
  console.log(`${env}: ${show(certificates[env].dnsNames)} routed, certified and on CloudFront`);
console.log('edge routing ok');
