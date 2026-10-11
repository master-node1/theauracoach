#!/usr/bin/env node
// Prints the deployables a change touches, as JSON, for the image and smoke jobs
// (deployment architecture §4, change detection). Usage: affected-services.mjs <base-ref> [head-ref]
// Turborepo's --affected already narrows lint, type checks and tests; this list drives Docker builds.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);
const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const nodeServices = readdirSync('services').filter(
  (d) => d.endsWith('-service') && existsSync(`services/${d}/Dockerfile`),
);
const deployables = [...nodeServices, 'api-gateway'];
const shared = [
  /^packages\//,
  /^tools\/(testing|dev-auth)\//,
  /^pnpm-lock\.yaml$/,
  /^package\.json$/,
  /^tsconfig\.base\.json$/,
  /^turbo\.json$/,
];
const everything = [
  /^\.github\/workflows\//,
  /^docker-compose\.yml$/,
  /^infra\//,
  /^\.dockerignore$/,
];

const selected = new Set();
for (const file of changed) {
  if (everything.some((r) => r.test(file))) deployables.forEach((d) => selected.add(d));
  else if (shared.some((r) => r.test(file))) nodeServices.forEach((d) => selected.add(d));
  else {
    const m = /^services\/([^/]+)\//.exec(file);
    if (m && deployables.includes(m[1])) selected.add(m[1]);
  }
}
process.stdout.write(JSON.stringify([...selected].sort()));
