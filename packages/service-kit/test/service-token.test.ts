import { describe, expect, it } from 'vitest';
import { mintServiceToken, verifyServiceToken } from '../src';

const secret = 'x'.repeat(40);

describe('service tokens', () => {
  it('round-trips issuer and acting user', async () => {
    const token = await mintServiceToken({
      secret,
      issuer: 'coach-service',
      audience: 'workout-service',
      subUser: '8f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c',
    });
    await expect(verifyServiceToken(token, secret, 'workout-service')).resolves.toEqual({
      service: 'coach-service',
      subUser: '8f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c',
    });
  });

  it('rejects a token meant for another service', async () => {
    const token = await mintServiceToken({
      secret,
      issuer: 'coach-service',
      audience: 'nutrition-service',
    });
    await expect(verifyServiceToken(token, secret, 'workout-service')).rejects.toThrow();
  });

  it('rejects a token signed with another secret', async () => {
    const token = await mintServiceToken({
      secret: 'y'.repeat(40),
      issuer: 'coach-service',
      audience: 'workout-service',
    });
    await expect(verifyServiceToken(token, secret, 'workout-service')).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await mintServiceToken({
      secret,
      issuer: 'coach-service',
      audience: 'workout-service',
      ttlSeconds: -60,
    });
    await expect(verifyServiceToken(token, secret, 'workout-service')).rejects.toThrow();
  });
});
