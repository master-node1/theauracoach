'use client';

import { useEffect, useState } from 'react';
import {
  ApiError,
  exportPollDelayMs,
  exportState,
  type DataRequestResponse,
} from '@aura/api-client';
import { useTranslations } from 'next-intl';
import { browserApi } from '@/lib/browser-api';

/**
 * "Export my data" (users LLD §3): starts an export, follows it until the zip is ready and offers
 * the 15-minute download link. Used in Settings and on the pending-deletion screen.
 */
export function ExportData({ initial }: { initial: DataRequestResponse | null }) {
  const [latest, setLatest] = useState(initial);
  const [failed, setFailed] = useState(false);
  const t = useTranslations('privacy.export');
  const state = exportState(latest);

  // While an export is being prepared, check on it with a growing interval.
  useEffect(() => {
    if (!latest || !state.busy) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await browserApi.getExport(latest.id);
        if (stopped) return;
        setLatest(next);
        if (!exportState(next).busy) return;
      } catch {
        // Keep trying; a blip should not end the wait.
      }
      timer = setTimeout(poll, exportPollDelayMs(++attempt));
    };
    timer = setTimeout(poll, exportPollDelayMs(attempt));
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [latest, state.busy]);

  async function start() {
    setFailed(false);
    try {
      setLatest(await browserApi.requestExport());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EXPORT_IN_PROGRESS') {
        const [running] = await browserApi.exports().catch(() => []);
        if (running) setLatest(running);
        return;
      }
      setFailed(true);
    }
  }

  return (
    <div className="settings-row" data-testid="export-row">
      <span>
        {t('title')}
        <span className="settings-hint" aria-live="polite" data-testid="export-state">
          {failed ? t('failed') : t(`states.${state.key}`)}
        </span>
      </span>
      {state.downloadUrl ? (
        <a className="button small" href={state.downloadUrl} download data-testid="export-download">
          {t('download')}
        </a>
      ) : (
        <button type="button" className="button small" onClick={start} disabled={state.busy}>
          {state.busy ? t('busy') : t('start')}
        </button>
      )}
    </div>
  );
}
