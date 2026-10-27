import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  COMMON_TIME_ZONES,
  consentState,
  createApiClient,
  envFlagDefaults,
  loadFlags,
  timeZoneOptions,
  trimTrailingSlashes,
} from '../src';

const me = {
  id: '0b6f5c1e-8f0a-4b8e-9c47-3d2a1e5f7a90',
  email: 'priya@example.com',
  displayName: null,
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
  onboardingComplete: false,
  status: 'ACTIVE',
  roles: ['user' as const],
  profile: null,
  preferences: { theme: 'system', coachTone: 'supportive' },
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

  it('sends settings changes as JSON with the right method', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = createApiClient({ baseUrl: 'http://gateway', fetch });
    await client.updatePreferences({ theme: 'dark' });
    await client.recordConsent({ purpose: 'AI_COACH', granted: false, policyVersion: '2026-10' });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['http://gateway/v1/me/preferences', 'PATCH', '{"theme":"dark"}'],
      [
        'http://gateway/v1/me/consents',
        'POST',
        '{"purpose":"AI_COACH","granted":false,"policyVersion":"2026-10"}',
      ],
    ]);
    expect(new Headers(calls[0]![1].headers).get('content-type')).toBe('application/json');
  });

  it('trims trailing slashes', () => {
    expect(trimTrailingSlashes('http://gateway///')).toBe('http://gateway');
    expect(trimTrailingSlashes('/'.repeat(100_000))).toBe('');
    expect(trimTrailingSlashes('http://gateway')).toBe('http://gateway');
  });
});

describe('loadFlags', () => {
  it('reads /v1/me/flags on top of the fallback', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ flags: { settings_v1: false } }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = createApiClient({ baseUrl: 'http://gw', fetch: fetchMock });
    const flags = await loadFlags(client, envFlagDefaults({ FEATURE_COACH_V1: 'false' }));
    expect(fetchMock).toHaveBeenCalledWith('http://gw/v1/me/flags', expect.anything());
    expect(flags).toMatchObject({ settings_v1: false, coach_v1: false, nutrition_v1: true });
  });

  it('falls back when the call fails', async () => {
    const client = createApiClient({
      baseUrl: 'http://gw',
      fetch: async () => new Response(null, { status: 503 }),
    });
    const fallback = envFlagDefaults({ FEATURE_SETTINGS_V1: 'false' });
    await expect(loadFlags(client, fallback)).resolves.toEqual(fallback);
  });
});

describe('settings helpers', () => {
  it('defaults listed consents to off and applies the latest answers', () => {
    expect(consentState([{ purpose: 'AI_COACH', granted: true }])).toMatchObject({
      AI_COACH: true,
      NOTIFICATIONS: false,
      MARKETING: false,
    });
  });

  it('keeps the current time zone selectable', () => {
    expect(timeZoneOptions('Asia/Kolkata')).toEqual([...COMMON_TIME_ZONES]);
    expect(timeZoneOptions('Asia/Tokyo')[0]).toBe('Asia/Tokyo');
  });
});
