'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  DELETE_ACCOUNT_COPY,
  DELETE_CONFIRMATION,
  deletionConfirmed,
  isReauthRequired,
} from '@aura/api-client';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resume) dialog.current?.showModal();
  }, [resume]);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!deletionConfirmed(typed)) return;
    setBusy(true);
    setError(null);
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
      setError('Could not delete the account. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-row">
        <span className="danger-text">
          Delete account
          <span className="settings-hint">Locks it now, erases everything after 30 days.</span>
        </span>
        <button
          type="button"
          className="button small danger"
          onClick={() => dialog.current?.showModal()}
        >
          Delete…
        </button>
      </div>
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-body`}
      >
        <form onSubmit={confirm}>
          <h2 id={`${ids}-title`}>{DELETE_ACCOUNT_COPY.title}</h2>
          <p id={`${ids}-body`}>{DELETE_ACCOUNT_COPY.body}</p>
          <p className="settings-muted">{DELETE_ACCOUNT_COPY.exportHint}</p>
          {resume ? (
            <p className="settings-muted">You signed in again. Press Delete account to finish.</p>
          ) : (
            <p className="settings-muted">{DELETE_ACCOUNT_COPY.reauth}</p>
          )}
          <label htmlFor={`${ids}-confirm`}>Type {DELETE_CONFIRMATION} to confirm</label>
          <input
            id={`${ids}-confirm`}
            className="input"
            value={typed}
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(e) => setTyped(e.target.value)}
          />
          {error && (
            <p className="settings-status error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button small"
              onClick={() => dialog.current?.close()}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button small danger"
              disabled={busy || !deletionConfirmed(typed)}
            >
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
