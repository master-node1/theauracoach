import { ApiError } from '@aura/api-client';

export type SaveStatus = { kind: 'saved' | 'error'; text: string } | null;

/**
 * Shows a change at once, then saves it; if the save fails the change is undone and the returned
 * status says why. Settings use it for every control.
 */
export async function saveOptimistically(
  apply: () => void,
  undo: () => void,
  call: () => Promise<unknown>,
): Promise<SaveStatus> {
  apply();
  try {
    await call();
    return { kind: 'saved', text: 'Saved' };
  } catch (err) {
    undo();
    const text =
      err instanceof ApiError && err.status === 422
        ? 'Please check the value and try again.'
        : 'Could not save. Check your connection and try again.';
    return { kind: 'error', text };
  }
}
