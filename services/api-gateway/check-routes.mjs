#!/usr/bin/env node
// Builds the gateway image, runs it against stub upstreams, and checks every route in routes.json.
// Needs Docker. Usage: node services/api-gateway/check-routes.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { routes, notRouted } = JSON.parse(readFileSync(join(here, 'routes.json'), 'utf8'));
const upstreams = ['profile', 'workout', 'nutrition', 'progress', 'coach', 'notification', 'audit'];
const image = 'aura-api-gateway:check';
const name = `aura-gw-check-${process.pid}`;
const gatewayPort = 18080;

const servers = await Promise.all(
  upstreams.map(
    (svc, i) =>
      new Promise((ok) => {
        const s = createServer((req, res) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              service: svc,
              path: req.url,
              requestId: req.headers['x-request-id'] ?? null,
              forwardedFor: req.headers['x-forwarded-for'] ?? null,
            }),
          );
        });
        s.listen(18100 + i, '127.0.0.1', () => ok(s));
      }),
  ),
);

let failures = 0;
try {
  execFileSync(
    'docker',
    ['build', '-q', '-t', image, '-f', 'services/api-gateway/Dockerfile', '.'],
    { cwd: root, stdio: 'pipe' },
  );
  const env = upstreams.flatMap((svc, i) => [
    '-e',
    `${svc.toUpperCase()}_UPSTREAM=127.0.0.1:${18100 + i}`,
  ]);
  env.push('-e', 'GATEWAY_RATE_PER_SECOND=1000'); // the burst of checks below must not be rate limited
  // Host networking lets nginx reach the stubs on 127.0.0.1; the gateway listens on 8080, mapped by an env override.
  execFileSync(
    'docker',
    ['run', '-d', '--rm', '--name', name, '--network', 'host', ...env, image],
    { stdio: 'pipe' },
  );
  execFileSync(
    'docker',
    [
      'exec',
      name,
      'sh',
      '-c',
      `sed -i 's/listen 8080/listen ${gatewayPort}/' /etc/nginx/conf.d/default.conf && nginx -s reload`,
    ],
    { stdio: 'pipe' },
  );
  await waitFor(`http://127.0.0.1:${gatewayPort}/health`);

  for (const [path, expected] of Object.entries(routes)) {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}${path}`, {
      headers: { 'x-request-id': 'check-routes-0001' },
    });
    const body = res.ok ? await res.json() : null;
    const okRoute =
      body?.service === expected && body.path === path && body.requestId === 'check-routes-0001';
    if (!okRoute) failures++;
    console.log(
      `${okRoute ? 'ok  ' : 'FAIL'} ${path} -> ${body?.service ?? res.status} (expected ${expected})`,
    );
  }
  for (const path of notRouted) {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}${path}`);
    const okRoute = res.status === 404 && res.headers.get('content-type')?.includes('problem+json');
    if (!okRoute) failures++;
    console.log(`${okRoute ? 'ok  ' : 'FAIL'} ${path} -> ${res.status} (expected 404)`);
  }
  // The address services and the per-IP limit see (deployment.md "Edge routing"): the viewer from
  // CloudFront-Viewer-Address, never what the client put in X-Forwarded-For; the peer without it.
  const [probe] = Object.keys(routes);
  for (const [viewer, expected] of [
    ['203.0.113.7:46532', '203.0.113.7'],
    ['2001:db8::1:443', '2001:db8::1'],
    [null, '127.0.0.1'],
  ]) {
    const headers = { 'x-forwarded-for': '198.51.100.66' };
    if (viewer) headers['cloudfront-viewer-address'] = viewer;
    const res = await fetch(`http://127.0.0.1:${gatewayPort}${probe}`, { headers });
    const seen = res.ok ? (await res.json()).forwardedFor : res.status;
    const okIp = seen === expected;
    if (!okIp) failures++;
    console.log(
      `${okIp ? 'ok  ' : 'FAIL'} client ${viewer ?? '(no header)'} -> ${seen} (expected ${expected})`,
    );
  }
} finally {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  servers.forEach((s) => s.close());
}
if (failures) {
  console.error(`${failures} route check(s) failed`);
  process.exit(1);
}
console.log('All gateway routes OK');

async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Gateway did not become healthy at ${url}`);
}
