'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { pendingDeletionText, type DataRequestResponse } from '@aura/api-client';
import { SignOutButton } from '@/components/SignOutButton';
import { browserApi } from '@/lib/browser-api';
import { ExportData } from './ExportData';

/**
 * Shown instead of the app while the account waits out its deletion grace period: restore it,
 * download a copy, or sign out (users LLD §4, TC-PRV-3).
 */
export function PendingDeletion({
  deletionDueAt,
  timeZone,
  latestExport,
}: {
  deletionDueAt: string | null;
  timeZone: string;
  latestExport: DataRequestResponse | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.restoreAccount();
      router.refresh();
    } catch {
      setError('Could not restore the account. Try again in a moment.');
      setBusy(false);
    }
  }

  return (
    <section className="card pending-deletion" aria-labelledby="pending-title">
      <h1 id="pending-title" className="page-title">
        Account scheduled for deletion
      </h1>
      <p data-testid="pending-deletion-text">{pendingDeletionText(deletionDueAt, timeZone)}</p>
      {error && (
        <p className="settings-status error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button primary" onClick={restore} disabled={busy}>
          {busy ? 'Restoring…' : 'Restore my account'}
        </button>
      </div>
      <div className="settings-list">
        <ExportData initial={latestExport} />
        <div className="settings-row">
          <SignOutButton />
        </div>
      </div>
    </section>
  );
}
