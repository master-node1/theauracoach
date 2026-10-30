'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  DELETE_CONFIRMATION,
  DELETION_GRACE_DAYS,
  deletionConfirmed,
  isReauthRequired,
} from '@aura/api-client';
import { useTranslations } from 'next-intl';
import { browserApi } from '@/lib/browser-api';

/** Where the fresh sign-in returns to: Settings, with the dialog open again. */
const RESUME = '/settings?delete=confirm';

/**
 * "Delete account": a confirmation dialog (type DELETE), then DELETE /v1/me. The API wants a
 * sign-in from the last five minutes; if this one is older the user signs in again and comes back
 * here to press the button once more. On success the app shows the pending-deletion screen.
 */
export function DeleteAccount({ resume }: { resume: boolean }) {
  const ids = useId();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState(resume ? DELETE_CONFIRMATION : '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = useTranslations('privacy.delete');
  const days = DELETION_GRACE_DAYS;

  useEffect(() => {
    if (resume) dialog.current?.showModal();
  }, [resume]);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!deletionConfirmed(typed)) return;
    setBusy(true);
    setFailed(false);
    try {
      await browserApi.deleteAccount();
      dialog.current?.close();
      router.replace('/');
      router.refresh();
    } catch (err) {
      if (isReauthRequired(err)) {
        window.location.assign(`/api/auth/login?reauth=1&returnTo=${encodeURIComponent(RESUME)}`);
        return;
      }
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-row">
        <span className="danger-text">
          {t('title')}
          <span className="settings-hint">{t('hint', { days })}</span>
        </span>
        <button
          type="button"
          className="button small danger"
          onClick={() => dialog.current?.showModal()}
        >
          {t('open')}
        </button>
      </div>
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-body`}
      >
        <form onSubmit={confirm}>
          <h2 id={`${ids}-title`}>{t('dialogTitle')}</h2>
          <p id={`${ids}-body`}>{t('body', { days })}</p>
          <p className="settings-muted">{t('exportHint')}</p>
          {resume ? (
            <p className="settings-muted">{t('resumed')}</p>
          ) : (
            <p className="settings-muted">{t('reauth')}</p>
          )}
          <label htmlFor={`${ids}-confirm`}>
            {t('confirmLabel', { word: DELETE_CONFIRMATION })}
          </label>
          <input
            id={`${ids}-confirm`}
            className="input"
            value={typed}
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(e) => setTyped(e.target.value)}
          />
          {failed && (
            <p className="settings-status error" role="alert">
              {t('failed')}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button small"
              onClick={() => dialog.current?.close()}
              disabled={busy}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="button small danger"
              disabled={busy || !deletionConfirmed(typed)}
            >
              {busy ? t('busy') : t('submit')}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
