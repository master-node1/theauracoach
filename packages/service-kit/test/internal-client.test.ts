import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INTERNAL_TOKEN_HEADER,
  InternalCallError,
  InternalClient,
  verifyServiceToken,
} from '../src';

const secret = 'k'.repeat(40);
let server: Server;
let base: string;
let hits = new Map<string, number>();
let lastRequest: IncomingMessage | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    lastRequest = req;
    const path = req.url ?? '';
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === '/internal/v1/ok')
      return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    if (path === '/internal/v1/flaky' && hits.get(path) === 1) return res.writeHead(503).end();
    if (path === '/internal/v1/flaky') return res.writeHead(200).end('{"ok":"second"}');
    if (path === '/internal/v1/slow') return setTimeout(() => res.writeHead(200).end('{}'), 500);
    if (path === '/internal/v1/missing')
      return res
        .writeHead(404, { 'content-type': 'application/problem+json' })
        .end('{"code":"NOT_FOUND"}');
    res.writeHead(503).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

function client() {
  hits = new Map();
  return new InternalClient({
    self: 'coach-service',
    secret,
    urls: { 'workout-service': base },
    retryDelayMs: () => 1,
  });
}

describe('InternalClient', () => {
  it('sends a service token for the target and acting user', async () => {
    const result = await client().call<{ ok: boolean }>('workout-service', {
      path: '/internal/v1/ok',
      asUser: '8f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c',
    });
    expect(result).toEqual({ ok: true });
    const token = lastRequest?.headers[INTERNAL_TOKEN_HEADER] as string;
    await expect(verifyServiceToken(token, secret, 'workout-service')).resolves.toMatchObject({
      service: 'coach-service',
      subUser: '8f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c',
    });
  });

  it('retries a GET once on 503', async () => {
    await expect(client().call('workout-service', { path: '/internal/v1/flaky' })).resolves.toEqual(
      { ok: 'second' },
    );
    expect(hits.get('/internal/v1/flaky')).toBe(2);
  });

  it('does not retry a write without an idempotency key', async () => {
    const c = client();
    await expect(
      c.call('workout-service', { method: 'POST', path: '/internal/v1/flaky', body: {} }),
    ).rejects.toBeInstanceOf(InternalCallError);
    expect(hits.get('/internal/v1/flaky')).toBe(1);
  });

  it('retries a write that carries an idempotency key', async () => {
    await expect(
      client().call('workout-service', {
        method: 'POST',
        path: '/internal/v1/flaky',
        body: {},
        idempotencyKey: 'onb-1',
      }),
    ).resolves.toEqual({ ok: 'second' });
  });

  it('times out and reports the target as unavailable', async () => {
    const err = await client()
      .call('workout-service', { path: '/internal/v1/slow', timeoutMs: 50 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalCallError);
    expect((err as InternalCallError).isUnavailable).toBe(true);
  });

  it('passes 4xx problems through without retrying', async () => {
    const err = (await client()
      .call('workout-service', { path: '/internal/v1/missing' })
      .catch((e: unknown) => e)) as InternalCallError;
    expect(err.status).toBe(404);
    expect(err.problem).toEqual({ code: 'NOT_FOUND' });
    expect(hits.get('/internal/v1/missing')).toBe(1);
  });

  it('refuses paths outside /internal/v1 and unknown targets', async () => {
    await expect(client().call('workout-service', { path: '/v1/me' })).rejects.toThrow(
      '/internal/v1/',
    );
    await expect(client().call('coach-service', { path: '/internal/v1/ok' })).rejects.toThrow(
      'No URL',
    );
  });
});
