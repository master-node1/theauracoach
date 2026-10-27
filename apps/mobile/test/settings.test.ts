import { ApiError } from '@aura/api-client';
import { describe, expect, it, vi } from 'vitest';
import { saveOptimistically } from '../src/settings/optimistic';
import { deleteWithReauth } from '../src/settings/privacy';
import { schemeFor } from '../src/settings/scheme';

describe('optimistic settings saves', () => {
  it('keeps the change when the save succeeds', async () => {
    const undo = vi.fn();
    const apply = vi.fn();
    const status = await saveOptimistically(apply, undo, async () => ({}));
    expect(apply).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
    expect(status).toBe('saved');
  });

  it('undoes the change and explains a failed save', async () => {
    const undo = vi.fn();
    const invalid = await saveOptimistically(vi.fn(), undo, () =>
      Promise.reject(new ApiError(422, null)),
    );
    expect(undo).toHaveBeenCalledOnce();
    expect(invalid).toBe('invalidValue');
    const offline = await saveOptimistically(vi.fn(), vi.fn(), () =>
      Promise.reject(new TypeError('Network request failed')),
    );
    expect(offline).toBe('saveFailed');
  });
});

describe('theme preference', () => {
  it('forces light or dark and otherwise follows the device', () => {
    expect(schemeFor('dark', 'light')).toBe('dark');
    expect(schemeFor('light', 'dark')).toBe('light');
    expect(schemeFor('system', 'dark')).toBe('dark');
    expect(schemeFor('system', null)).toBe('light');
  });
});

describe('account deletion with a fresh sign-in', () => {
  const due = { deletionDueAt: '2026-11-26T10:00:00.000Z' };
  const reauth = () => new ApiError(403, { code: 'REAUTH_REQUIRED' } as never);

  it('deletes straight away when the sign-in is fresh', async () => {
    const reauthenticate = vi.fn();
    expect(await deleteWithReauth(async () => due, reauthenticate)).toEqual({
      kind: 'scheduled',
      ...due,
    });
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it('signs in again once, then retries', async () => {
    const remove = vi.fn().mockRejectedValueOnce(reauth()).mockResolvedValueOnce(due);
    const outcome = await deleteWithReauth(remove, async () => true);
    expect(outcome).toEqual({ kind: 'scheduled', ...due });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('stops when the user backs out of signing in, or the new sign-in is still refused', async () => {
    expect(
      await deleteWithReauth(
        () => Promise.reject(reauth()),
        async () => false,
      ),
    ).toEqual({
      kind: 'cancelled',
    });
    const remove = vi.fn().mockRejectedValue(reauth());
    expect((await deleteWithReauth(remove, async () => true)).kind).toBe('error');
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('explains other failures', async () => {
    const outcome = await deleteWithReauth(
      () => Promise.reject(new TypeError('Network request failed')),
      vi.fn(),
    );
    expect(outcome).toEqual({ kind: 'error', text: expect.stringMatching(/connection/) });
  });
});
