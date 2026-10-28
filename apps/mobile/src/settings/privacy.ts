import { isReauthRequired } from '@aura/api-client';

export type DeleteOutcome =
  | { kind: 'scheduled'; deletionDueAt: string }
  | { kind: 'cancelled' }
  /** Words for each reason are at `privacy.delete.<reason>` in the catalogue. */
  | { kind: 'error'; reason: 'reauthAgain' | 'failed' };

/**
 * DELETE /v1/me with the fresh sign-in the API asks for (users LLD §4). When the current sign-in
 * is too old the user signs in again (`reauthenticate`, false when they back out) and the request
 * is sent once more; it never loops.
 */
export async function deleteWithReauth(
  remove: () => Promise<{ deletionDueAt: string }>,
  reauthenticate: () => Promise<boolean>,
): Promise<DeleteOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { kind: 'scheduled', ...(await remove()) };
    } catch (err) {
      if (!isReauthRequired(err)) break;
      if (attempt > 0) return { kind: 'error', reason: 'reauthAgain' };
      if (!(await reauthenticate())) return { kind: 'cancelled' };
    }
  }
  return { kind: 'error', reason: 'failed' };
}
