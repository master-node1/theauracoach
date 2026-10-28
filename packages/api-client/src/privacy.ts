import type { DataRequestResponse } from '@aura/contracts';

/**
 * Export and deletion copy and rules shared by the web and mobile Settings and the
 * pending-deletion screen, so both apps behave and read the same (users LLD §3–4).
 */

/** What the user types to confirm deletion. */
export const DELETE_CONFIRMATION = 'DELETE';

export function deletionConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_CONFIRMATION;
}

/** Days the account can still be restored (from DELETION_GRACE_DAYS on the server). */
export const DELETION_GRACE_DAYS = 30;

export const DELETE_ACCOUNT_COPY = {
  title: 'Delete your account?',
  body:
    `Your account is locked straight away and deleted for good after ${DELETION_GRACE_DAYS} days. ` +
    'Until then you can sign in and restore it. After that your workouts, meals, progress, coach ' +
    'chats and profile are erased and cannot be recovered.',
  exportHint: 'Want a copy first? Export your data before you delete.',
  reauth: 'For your security, sign in again to confirm.',
} as const;

/** "26 November 2026" in the user's time zone. */
export function formatDeletionDate(iso: string, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

export function pendingDeletionText(deletionDueAt: string | null, timeZone?: string): string {
  const when = deletionDueAt ? formatDeletionDate(deletionDueAt, timeZone) : 'soon';
  return `Your account will be deleted on ${when}. Restore it to keep using AuraCoach, or download your data first.`;
}

/** The export row's state: what to show and whether a download link is available. */
export function exportState(latest: DataRequestResponse | null): {
  label: string;
  busy: boolean;
  downloadUrl: string | null;
} {
  if (!latest)
    return { label: 'Get a copy of everything we hold about you.', busy: false, downloadUrl: null };
  switch (latest.status) {
    case 'queued':
    case 'running':
      return {
        label: 'Preparing your export… this usually takes a minute.',
        busy: true,
        downloadUrl: null,
      };
    case 'ready':
      return {
        label: 'Your export is ready (zip with JSON and CSV).',
        busy: false,
        downloadUrl: latest.downloadUrl,
      };
    case 'failed':
      return {
        label: 'The last export did not finish. Try again.',
        busy: false,
        downloadUrl: null,
      };
    default:
      return {
        label: 'Get a copy of everything we hold about you.',
        busy: false,
        downloadUrl: null,
      };
  }
}

/** Polling interval while an export is being prepared: 2 s, growing to 10 s. */
export function exportPollDelayMs(attempt: number): number {
  return Math.min(2000 + attempt * 1000, 10_000);
}
