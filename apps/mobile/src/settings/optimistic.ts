import { ApiError } from '@aura/api-client';

/** A `common.*` message key: the outcome shown under the Settings header. */
export type SaveStatus = 'saved' | 'invalidValue' | 'saveFailed' | null;

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
    return 'saved';
  } catch (err) {
    undo();
    return err instanceof ApiError && err.status === 422 ? 'invalidValue' : 'saveFailed';
  }
}
