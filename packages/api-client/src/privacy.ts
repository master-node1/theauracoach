import type { DataRequestResponse } from '@aura/contracts';

/**
 * Export and deletion rules shared by the web and mobile Settings and the pending-deletion
 * screen, so both apps behave the same (users LLD §3–4). Their text is in @aura/i18n (`privacy.*`).
 */

/** What the user types to confirm deletion. */
export const DELETE_CONFIRMATION = 'DELETE';

export function deletionConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_CONFIRMATION;
}

/** Days the account can still be restored (from DELETION_GRACE_DAYS on the server). */
export const DELETION_GRACE_DAYS = 30;

/**
 * The export row's state: which catalogue text to show (`privacy.export.states.*`), whether an
 * export is being prepared and whether a download link is available.
 */
export type ExportStateKey = 'none' | 'preparing' | 'ready' | 'failed';

export function exportState(latest: DataRequestResponse | null): {
  key: ExportStateKey;
  busy: boolean;
  downloadUrl: string | null;
} {
  switch (latest?.status) {
    case 'queued':
    case 'running':
      return { key: 'preparing', busy: true, downloadUrl: null };
    case 'ready':
      return { key: 'ready', busy: false, downloadUrl: latest.downloadUrl };
    case 'failed':
      return { key: 'failed', busy: false, downloadUrl: null };
    default:
      return { key: 'none', busy: false, downloadUrl: null };
  }
}

/** Polling interval while an export is being prepared: 2 s, growing to 10 s. */
export function exportPollDelayMs(attempt: number): number {
  return Math.min(2000 + attempt * 1000, 10_000);
}
