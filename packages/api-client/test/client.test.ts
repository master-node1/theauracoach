import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../src';

const me = {
  id: '0b6f5c1e-8f0a-4b8e-9c47-3d2a1e5f7a90',
  email: 'priya@example.com',
  displayName: null,
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
  onboardingComplete: false,
  status: 'ACTIVE',
  roles: ['user' as const],
};

describe('api client', () => {
  it('calls /v1/me with the bearer token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(me), { status: 200 }));
    const client = createApiClient({
      baseUrl: 'http://gateway/',
      getAccessToken: async () => 'token-1',
      fetch,
    });
    await expect(client.me()).resolves.toEqual(me);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gateway/v1/me');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token-1');
  });

  it('sends no authorization header without a token', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    await createApiClient({ baseUrl: 'http://gateway', fetch }).request('/health');
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it('turns problem documents into ApiError', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Unauthenticated',
      status: 401,
      code: 'UNAUTHENTICATED',
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(problem), { status: 401 }));
    const error = await createApiClient({ baseUrl: 'http://gateway', fetch })
      .me()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe('UNAUTHENTICATED');
  });
});
