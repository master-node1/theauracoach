'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DataRequestResponse } from '@aura/api-client';
import { formatDate } from '@aura/i18n';
import { useLocale, useTranslations } from 'next-intl';
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
  const [failed, setFailed] = useState(false);
  const t = useTranslations('privacy.pending');
  const locale = useLocale();

  async function restore() {
    setBusy(true);
    setFailed(false);
    try {
      await browserApi.restoreAccount();
      router.refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <section className="card pending-deletion" aria-labelledby="pending-title">
      <h1 id="pending-title" className="page-title">
        {t('title')}
      </h1>
      <p data-testid="pending-deletion-text">
        {deletionDueAt
          ? t('body', { date: formatDate(new Date(deletionDueAt), { locale, timeZone }) })
          : t('bodySoon')}
      </p>
      {failed && (
        <p className="settings-status error" role="alert">
          {t('failed')}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button primary" onClick={restore} disabled={busy}>
          {busy ? t('busy') : t('restore')}
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
