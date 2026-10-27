import { ApiError } from '@aura/api-client';
import { describe, expect, it, vi } from 'vitest';
import { saveOptimistically } from '../src/settings/optimistic';
import { schemeFor } from '../src/settings/scheme';

describe('optimistic settings saves', () => {
  it('keeps the change when the save succeeds', async () => {
    const undo = vi.fn();
    const apply = vi.fn();
    const status = await saveOptimistically(apply, undo, async () => ({}));
    expect(apply).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
    expect(status).toEqual({ kind: 'saved', text: 'Saved' });
  });

  it('undoes the change and explains a failed save', async () => {
    const undo = vi.fn();
    const invalid = await saveOptimistically(vi.fn(), undo, () =>
      Promise.reject(new ApiError(422, null)),
    );
    expect(undo).toHaveBeenCalledOnce();
    expect(invalid).toEqual({ kind: 'error', text: 'Please check the value and try again.' });
    const offline = await saveOptimistically(vi.fn(), vi.fn(), () =>
      Promise.reject(new TypeError('Network request failed')),
    );
    expect(offline?.text).toMatch(/connection/);
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
