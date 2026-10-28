import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { ServiceName } from '@aura/contracts';
import { DEV_CLIENT_ID } from '@aura/dev-auth';
import { Client } from 'pg';

export {
  createDevIssuer,
  DEV_CLIENT_ID,
  GroupStore,
  handleGroupTarget,
  type DevIssuer,
} from '@aura/dev-auth';

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

export function requireEnv(name: 'TEST_DATABASE_URL' | 'TEST_REDIS_URL'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for integration tests (see docs/operations/local-development.md)`,
    );
  }
  return value;
}

/**
 * Creates a scratch database on the TEST_DATABASE_URL server and applies the service's
 * Prisma migrations with `prisma migrate deploy`, exactly as the Helm pre-upgrade hook does.
 */
export async function createTestDatabase(serviceDir: string, label: string): Promise<TestDatabase> {
  const server = requireEnv('TEST_DATABASE_URL');
  const name =
    `${label.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}_${randomBytes(3).toString('hex')}`.toLowerCase();
  await withAdmin(server, (c) => c.query(`CREATE DATABASE "${name}"`));
  const url = new URL(server);
  url.pathname = `/${name}`;
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: serviceDir,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
  return {
    url: url.toString(),
    drop: () =>
      withAdmin(server, (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).then(
        () => undefined,
      ),
  };
}

async function withAdmin<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const TEST_INTERNAL_SECRET = 'test-internal-secret-0123456789abcdef';

/** Environment for booting a service in tests. Redis db 1–14 keeps parallel suites apart. */
export function testEnv(input: {
  service: ServiceName;
  databaseUrl: string;
  issuer: string;
  redisDb?: number;
  serviceUrls?: string;
}): NodeJS.ProcessEnv {
  const redis = new URL(requireEnv('TEST_REDIS_URL'));
  redis.pathname = `/${input.redisDb ?? 1}`;
  return {
    NODE_ENV: 'test',
    SERVICE_NAME: input.service,
    PORT: '3999', // not listened on: tests use supertest against the app
    LOG_LEVEL: 'silent',
    DATABASE_URL: input.databaseUrl,
    REDIS_URL: redis.toString(),
    AUTH_JWKS_URL: 'http://127.0.0.1:1/.well-known/jwks.json',
    AUTH_ISSUER: input.issuer,
    AUTH_CLIENT_IDS: DEV_CLIENT_ID,
    INTERNAL_TOKEN_SECRET: TEST_INTERNAL_SECRET,
    INTERNAL_SERVICE_URLS: input.serviceUrls ?? '',
  };
}
