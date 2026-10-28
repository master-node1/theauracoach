// node --test tools/deploy/test tools/release/test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deployInputs } from '../deploy-inputs.mjs';

const issuer = (pool) => `https://cognito-idp.ap-south-1.amazonaws.com/${pool}`;
const oidc = (pool) => ({
  issuer: issuer(pool),
  jwks_url: `${issuer(pool)}/.well-known/jwks.json`,
  hosted_ui_url: `https://${pool}.auth.ap-south-1.amazoncognito.com`,
  identity_endpoint: 'https://cognito-idp.ap-south-1.amazonaws.com',
  web_client_id: `${pool}-web`,
  mobile_client_id: `${pool}-mobile`,
});

const nonprod = {
  oidc: { value: { dev: oidc('ap-south-1_DEV'), staging: oidc('ap-south-1_STG') } },
  k3s_instance_id: { value: 'i-0123' },
  helm_inputs: {
    value: {
      image_registry: '222222222222.dkr.ecr.ap-south-1.amazonaws.com',
      origin_host: 'origin.test.example.app',
      secrets_role_arns: {
        dev: 'arn:aws:iam::222222222222:role/d',
        staging: 'arn:aws:iam::222222222222:role/s',
      },
      platform_secrets_role_arn: 'arn:aws:iam::222222222222:role/p',
      hosted_zone_id: 'ZNONPROD',
      web_app_urls: {
        dev: 'https://app.dev.test.example.app',
        staging: 'https://app.staging.test.example.app',
      },
    },
  },
};

const prod = {
  oidc: { value: oidc('ap-south-1_PROD') },
  helm_inputs: {
    value: {
      image_registry: '111111111111.dkr.ecr.ap-south-1.amazonaws.com',
      origin_host: 'origin.example.app',
      secrets_role_arns: { prod: 'arn:aws:iam::111111111111:role/prod' },
      platform_secrets_role_arn: 'arn:aws:iam::111111111111:role/p',
      hosted_zone_id: 'ZPROD',
      datastore_cidrs: ['10.20.32.0/24', '10.20.33.0/24'],
      web_app_url: 'https://app.example.app',
    },
  },
};

test('non-prod environments pick their own Cognito pool and app URL', () => {
  const { account, service, platform } = deployInputs('staging', nonprod, {
    acmeEmail: 'ops@example.app',
  });
  assert.equal(account, 'nonprod');
  assert.equal(service.global.imageRegistry, '222222222222.dkr.ecr.ap-south-1.amazonaws.com');
  assert.deepEqual(service.global.auth, {
    issuer: issuer('ap-south-1_STG'),
    jwksUrl: `${issuer('ap-south-1_STG')}/.well-known/jwks.json`,
    clientIds: ['ap-south-1_STG-web', 'ap-south-1_STG-mobile'],
    userPoolId: 'ap-south-1_STG',
  });
  assert.equal(service.web.appUrl, 'https://app.staging.test.example.app');
  assert.equal(service.ingress.host, 'origin.test.example.app');
  assert.equal(service.global.datastores, undefined, 'non-prod data stores are in-cluster');
  assert.deepEqual(Object.keys(platform.environments), ['dev', 'staging']);
  assert.equal(platform.environments.dev.secretsRoleArn, 'arn:aws:iam::222222222222:role/d');
  assert.equal(platform.acme.email, 'ops@example.app');
});

test('prod adds the RDS and ElastiCache subnet CIDRs', () => {
  const { account, service, platform } = deployInputs('prod', prod);
  assert.equal(account, 'prod');
  assert.equal(service.global.auth.userPoolId, 'ap-south-1_PROD');
  assert.deepEqual(service.global.datastores.postgres.cidrs, ['10.20.32.0/24', '10.20.33.0/24']);
  assert.deepEqual(service.global.datastores.redis.cidrs, ['10.20.32.0/24', '10.20.33.0/24']);
  assert.deepEqual(Object.keys(platform.environments), ['prod']);
});

test('no secret ever lands in the inputs', () => {
  const text = JSON.stringify(deployInputs('prod', prod));
  assert.doesNotMatch(text, /originVerify|_SECRET|password/i);
});

test('missing outputs fail loudly', () => {
  assert.throws(() => deployInputs('dev', { oidc: nonprod.oidc }), /helm_inputs is missing/);
  assert.throws(() => deployInputs('qa', nonprod), /unknown environment/);
});
