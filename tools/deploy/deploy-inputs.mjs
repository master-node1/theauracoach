#!/usr/bin/env node
// Turns `terraform output -json` of an account stack (infra/terraform/envs/<account>) into the Helm
// deploy inputs of deployment.md §2, as JSON values files (JSON is valid YAML, so `helm -f` reads it).
// Writes no secret: the origin header value is read separately by the deploy job.
// Usage: deploy-inputs.mjs <env> <terraform-output.json> <out-dir>
//   writes <out-dir>/service-inputs.json (aura-service) and <out-dir>/platform-inputs.json (aura-platform)
// ACME_EMAIL (environment) is the Let's Encrypt account e-mail for the platform inputs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV_ACCOUNT = { dev: 'nonprod', staging: 'nonprod', prod: 'prod' };

export function deployInputs(env, outputs, { acmeEmail = '' } = {}) {
  const account = ENV_ACCOUNT[env];
  if (!account) throw new Error(`unknown environment ${env} (dev, staging or prod)`);
  const value = (name) => {
    const o = outputs[name];
    if (!o || o.value === undefined) throw new Error(`terraform output ${name} is missing`);
    return o.value;
  };
  const helm = value('helm_inputs');
  // nonprod keys its Cognito outputs by environment; prod has one pool.
  const oidc = account === 'prod' ? value('oidc') : value('oidc')[env];
  if (!oidc) throw new Error(`terraform output oidc has no entry for ${env}`);
  const appUrl = account === 'prod' ? helm.web_app_url : helm.web_app_urls?.[env];
  if (!appUrl) throw new Error(`terraform output helm_inputs has no web app URL for ${env}`);
  // CloudFront forwards the viewer Host, so the ingress and the origin certificate use the public
  // hosts, which must be on the distribution (deployment.md "Edge routing").
  const hostsOf = (e) => {
    const h = helm.public_hosts?.[e];
    if (!h?.web || !h?.api) {
      throw new Error(`terraform output helm_inputs.public_hosts has no web and api host for ${e}`);
    }
    const missing = [h.web, h.api].filter((x) => !value('cloudfront_aliases').includes(x));
    if (missing.length) {
      throw new Error(
        `${missing.join(', ')} not on the CloudFront distribution (cloudfront_aliases)`,
      );
    }
    return { web: h.web, api: h.api };
  };
  // The issuer is https://cognito-idp.<region>.amazonaws.com/<user pool id>.
  const userPoolId = new URL(oidc.issuer).pathname.replace(/^\/+|\/+$/g, '');

  const service = {
    global: {
      imageRegistry: helm.image_registry,
      hosts: hostsOf(env),
      auth: {
        issuer: oidc.issuer,
        jwksUrl: oidc.jwks_url,
        clientIds: [oidc.web_client_id, oidc.mobile_client_id],
        userPoolId,
      },
    },
    web: { appUrl, oidcDomainUrl: oidc.hosted_ui_url, oidcClientId: oidc.web_client_id },
  };
  if (account === 'prod') {
    service.global.datastores = {
      postgres: { cidrs: helm.datastore_cidrs },
      redis: { cidrs: helm.datastore_cidrs },
    };
  }

  const environments = Object.fromEntries(
    Object.entries(ENV_ACCOUNT)
      .filter(([, a]) => a === account)
      .map(([e]) => [
        e,
        { secretsRoleArn: helm.secrets_role_arns[e], hosts: Object.values(hostsOf(e)) },
      ]),
  );
  const platform = {
    acme: { email: acmeEmail, hostedZoneId: helm.hosted_zone_id },
    environments,
    system: { secretsRoleArn: helm.platform_secrets_role_arn },
  };
  return { account, service, platform };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [env, file, outDir] = process.argv.slice(2);
  if (!env || !file || !outDir) {
    console.error('usage: deploy-inputs.mjs <env> <terraform-output.json> <out-dir>');
    process.exit(2);
  }
  const { service, platform } = deployInputs(env, JSON.parse(readFileSync(file, 'utf8')), {
    acmeEmail: process.env.ACME_EMAIL ?? '',
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'service-inputs.json'), `${JSON.stringify(service, null, 2)}\n`);
  writeFileSync(join(outDir, 'platform-inputs.json'), `${JSON.stringify(platform, null, 2)}\n`);
  console.log(`wrote deploy inputs for ${env} to ${outDir}`);
}
