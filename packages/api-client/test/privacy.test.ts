import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  deletionConfirmed,
  exportPollDelayMs,
  exportState,
  formatDeletionDate,
  isPendingDeletion,
  isReauthRequired,
  pendingDeletionText,
} from '../src';

const ready = {
  id: 'e1',
  kind: 'export' as const,
  status: 'ready' as const,
  createdAt: '2026-10-27T10:00:00.000Z',
  completedAt: '2026-10-27T10:01:00.000Z',
  downloadUrl: 'https://s3/x.zip',
  downloadExpiresAt: '2026-10-27T10:16:00.000Z',
  expiresAt: '2026-11-03T10:01:00.000Z',
};

describe('privacy client calls', () => {
  it('uses the documented routes and methods', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(ready), { status: 202 }));
    const api = createApiClient({ baseUrl: 'http://gw', fetch });
    await api.requestExport();
    await api.getExport('e 1');
    await api.deleteAccount();
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => `${init.method ?? 'GET'} ${url}`)).toEqual([
      'POST http://gw/v1/me/exports',
      'GET http://gw/v1/me/exports/e%201',
      'DELETE http://gw/v1/me',
    ]);
  });

  it('treats 204 from restore as success', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(createApiClient({ baseUrl: 'http://gw', fetch }).restoreAccount()).resolves.toBe(
      undefined,
    );
  });
});

describe('privacy helpers', () => {
  it('recognises the pending-deletion and re-auth problems', () => {
    expect(isPendingDeletion(new ApiError(423, { code: 'ACCOUNT_PENDING_DELETION' }))).toBe(true);
    expect(isReauthRequired(new ApiError(403, { code: 'REAUTH_REQUIRED' }))).toBe(true);
    expect(isReauthRequired(new ApiError(403, { code: 'FORBIDDEN' }))).toBe(false);
    expect(isPendingDeletion(new Error('x'))).toBe(false);
  });

  it('confirms deletion only with the exact word', () => {
    expect(deletionConfirmed(' delete ')).toBe(true);
    expect(deletionConfirmed('DELET')).toBe(false);
  });

  it('formats the deletion date in the user time zone', () => {
    expect(formatDeletionDate('2026-11-26T20:00:00.000Z', 'Asia/Kolkata')).toBe('27 November 2026');
    expect(pendingDeletionText('2026-11-26T10:00:00.000Z')).toContain('26 November 2026');
  });

  it('describes each export state', () => {
    expect(exportState(null).busy).toBe(false);
    expect(exportState({ ...ready, status: 'running', downloadUrl: null }).busy).toBe(true);
    expect(exportState(ready).downloadUrl).toBe('https://s3/x.zip');
    expect(exportState({ ...ready, status: 'expired', downloadUrl: null }).downloadUrl).toBeNull();
    expect(exportPollDelayMs(0)).toBe(2000);
    expect(exportPollDelayMs(50)).toBe(10_000);
  });
});
