import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseServiceUrls } from '../src';

const env = {
  SERVICE_NAME: 'profile-service',
  PORT: '3001',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/profile',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWKS_URL: 'http://localhost:4100/.well-known/jwks.json',
  AUTH_ISSUER: 'http://localhost:4100',
  AUTH_CLIENT_IDS: 'web, mobile',
  INTERNAL_TOKEN_SECRET: 's'.repeat(32),
};

describe('loadConfig', () => {
  it('parses and coerces a valid environment', () => {
    const config = loadConfig(undefined, env);
    expect(config.PORT).toBe(3001);
    expect(config.AUTH_CLIENT_IDS).toEqual(['web', 'mobile']);
    expect(config.NODE_ENV).toBe('development');
  });

  it('names bad variables without echoing secret values', () => {
    const secret = 'short-secret';
    try {
      loadConfig(undefined, { ...env, INTERNAL_TOKEN_SECRET: secret, SERVICE_NAME: 'nope' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as Error).message;
      expect(message).toContain('INTERNAL_TOKEN_SECRET');
      expect(message).toContain('SERVICE_NAME');
      expect(message).not.toContain(secret);
    }
  });
});

describe('parseServiceUrls', () => {
  it('parses name=url pairs and strips trailing slashes', () => {
    expect(
      parseServiceUrls('workout-service=http://workout:3000/, coach-service=http://coach:3000'),
    ).toEqual({
      'workout-service': 'http://workout:3000',
      'coach-service': 'http://coach:3000',
    });
  });

  it('rejects malformed entries', () => {
    expect(() => parseServiceUrls('workout-service')).toThrow(ConfigError);
  });
});
