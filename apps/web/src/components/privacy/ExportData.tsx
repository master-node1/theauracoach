'use client';

import { useEffect, useState } from 'react';
import {
  ApiError,
  exportPollDelayMs,
  exportState,
  type DataRequestResponse,
} from '@aura/api-client';
import { browserApi } from '@/lib/browser-api';

/**
 * "Export my data" (users LLD §3): starts an export, follows it until the zip is ready and offers
 * the 15-minute download link. Used in Settings and on the pending-deletion screen.
 */
export function ExportData({ initial }: { initial: DataRequestResponse | null }) {
  const [latest, setLatest] = useState(initial);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    try {
      setLatest(await browserApi.requestExport());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EXPORT_IN_PROGRESS') {
        const [running] = await browserApi.exports().catch(() => []);
        if (running) setLatest(running);
        return;
      }
      setError('Could not start the export. Check your connection and try again.');
    }
  }

  return (
    <div className="settings-row" data-testid="export-row">
      <span>
        Export my data
        <span className="settings-hint" aria-live="polite" data-testid="export-state">
          {error ?? state.label}
        </span>
      </span>
      {state.downloadUrl ? (
        <a className="button small" href={state.downloadUrl} download data-testid="export-download">
          Download
        </a>
      ) : (
        <button type="button" className="button small" onClick={start} disabled={state.busy}>
          {state.busy ? 'Preparing…' : 'Export'}
        </button>
      )}
    </div>
  );
}
