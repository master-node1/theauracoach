#!/usr/bin/env node
// Prints the deployables a change touches, as JSON, for the image, smoke and CD jobs
// (deployment architecture §4, change detection). Turborepo's --affected already narrows lint,
// type checks and tests; this list drives Docker builds, image pushes and Helm deploys.
// Usage: affected-services.mjs <base-ref> [head-ref]   or   affected-services.mjs --all
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const all = args[0] === '--all';
const [base = 'origin/main', head = 'HEAD'] = all ? [] : args;

const nodeServices = readdirSync('services').filter(
  (d) => d.endsWith('-service') && existsSync(`services/${d}/Dockerfile`),
);
const deployables = [...nodeServices, 'api-gateway', 'web'];
if (all) {
  process.stdout.write(JSON.stringify([...deployables].sort()));
  process.exit(0);
}

const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);
const shared = [
  // ui-tokens and api-client are only used by apps/*, so they do not rebuild service images.
  /^packages\/(contracts|service-kit)\//,
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

// Domain engines rebuild only the services that declare @aura/domain.
const domainUsers = nodeServices.filter((d) => {
  const pkg = JSON.parse(readFileSync(`services/${d}/package.json`, 'utf8'));
  return Boolean({ ...pkg.dependencies, ...pkg.devDependencies }['@aura/domain']);
});

// The web image contains apps/web and the workspace packages it depends on.
const webPkg = JSON.parse(readFileSync('apps/web/package.json', 'utf8'));
const webPackages = Object.entries({ ...webPkg.dependencies })
  .filter(([, v]) => String(v).startsWith('workspace:'))
  .map(([name]) => name.replace(/^@aura\//, ''));
const webPaths = [
  /^apps\/web\//,
  new RegExp(`^packages\\/(${webPackages.join('|')})\\/`),
  /^pnpm-lock\.yaml$/,
  /^package\.json$/,
  /^tsconfig\.base\.json$/,
  /^turbo\.json$/,
];

const selected = new Set();
for (const file of changed) {
  if (webPaths.some((r) => r.test(file))) selected.add('web');
  if (everything.some((r) => r.test(file))) deployables.forEach((d) => selected.add(d));
  else if (shared.some((r) => r.test(file))) nodeServices.forEach((d) => selected.add(d));
  else if (/^packages\/domain\//.test(file)) domainUsers.forEach((d) => selected.add(d));
  else {
    const m = /^services\/([^/]+)\//.exec(file);
    if (m && deployables.includes(m[1])) selected.add(m[1]);
  }
}
process.stdout.write(JSON.stringify([...selected].sort()));
