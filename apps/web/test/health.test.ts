import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { config } from '@/proxy';

describe('GET /api/health', () => {
  it('answers ok without a session or config', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('is not behind the session proxy', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test('/api/health')).toBe(false);
    expect(matcher.test('/api/v1/me')).toBe(true);
  });
});
