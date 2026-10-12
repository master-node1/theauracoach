import { describe, expect, it, vi } from 'vitest';
import {
  STORE_KEYS,
  deserialize,
  fromTokenResult,
  needsRefresh,
  serialize,
  singleFlight,
} from '../src/auth/tokens';

describe('mobile token handling', () => {
  it('computes expiry and keeps the old refresh token when none is returned', () => {
    const first = fromTokenResult(
      { accessToken: 'a1', refreshToken: 'r1', expiresIn: 900, issuedAt: 1000 },
      null,
    );
    expect(first).toEqual({ accessToken: 'a1', refreshToken: 'r1', expiresAt: 1900 });
    const refreshed = fromTokenResult({ accessToken: 'a2', expiresIn: 900 }, 'r1', 2000);
    expect(refreshed).toEqual({ accessToken: 'a2', refreshToken: 'r1', expiresAt: 2900 });
    expect(() => fromTokenResult({ accessToken: 'a' }, null)).toThrow();
  });

  it('refreshes when under 60 s remain', () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 1000 };
    expect(needsRefresh(tokens, 939)).toBe(false);
    expect(needsRefresh(tokens, 940)).toBe(true);
  });

  it('round-trips through the secure-store keys', () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 1234 };
    const stored = serialize(tokens);
    expect(Object.keys(stored).sort()).toEqual(Object.values(STORE_KEYS).sort());
    expect(deserialize(stored)).toEqual(tokens);
    expect(deserialize({ ...stored, [STORE_KEYS.refresh]: null })).toBeNull();
  });

  it('shares one refresh between concurrent callers', async () => {
    let release: (v: string) => void = () => undefined;
    const fn = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const once = singleFlight(fn);
    const both = Promise.all([once(), once()]);
    release('token');
    expect(await both).toEqual(['token', 'token']);
    expect(fn).toHaveBeenCalledTimes(1);
    once();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
