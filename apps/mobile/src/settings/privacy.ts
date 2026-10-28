import { isReauthRequired } from '@aura/api-client';

export type DeleteOutcome =
  | { kind: 'scheduled'; deletionDueAt: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; text: string };

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
      if (attempt > 0) return { kind: 'error', text: 'Please sign in again to confirm.' };
      if (!(await reauthenticate())) return { kind: 'cancelled' };
    }
  }
  return {
    kind: 'error',
    text: 'Could not delete the account. Check your connection and try again.',
  };
}
