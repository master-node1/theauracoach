'use client';

import { useId, useRef, useState } from 'react';
import { ApiError } from '@aura/api-client';

/** Problem codes the console explains in words; anything else gets the generic message. */
const ERROR_TEXT: Record<string, string> = {
  LAST_OWNER: 'Grant owner to someone else before removing the last owner.',
  USER_NOT_FOUND: 'No account uses that email.',
  ROLE_GRANT_NOT_FOUND: 'That role was already removed.',
  DLQ_ENTRY_NOT_FOUND: 'That event is no longer in the queue; it may have been replayed already.',
  DLQ_ENTRY_NOT_REPLAYABLE: 'That entry has no event to replay.',
  IDENTITY_UNAVAILABLE: 'Sign-in groups could not be updated, so nothing was changed. Try again.',
  MFA_REQUIRED: 'Sign in again with two-step verification.',
  FORBIDDEN: 'Your roles do not allow this.',
};

export function actionErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code && ERROR_TEXT[err.code]) return ERROR_TEXT[err.code]!;
    if (err.status === 422) return 'Please check the values and try again.';
  }
  return 'That did not work. Check your connection and try again.';
}

/**
 * A button that opens a dialog asking why, then runs `onConfirm(reason)`. Sensitive admin actions
 * use it so every audit entry carries a reason (admin LLD §5).
 */
export function ReasonDialog({
  label,
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setReason('');
    setError(null);
    dialog.current?.showModal();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (text.length < 3) {
      setError('Give a short reason (at least 3 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text);
      dialog.current?.close();
    } catch (err) {
      setError(actionErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={`button small${danger ? ' danger' : ''}`} onClick={open}>
        {label}
      </button>
      <dialog ref={dialog} className="admin-dialog" aria-labelledby={`${ids}-title`}>
        <form onSubmit={submit} className="admin-form">
          <h2 id={`${ids}-title`}>{title}</h2>
          <p>{description}</p>
          <label htmlFor={`${ids}-reason`}>Reason (kept in the audit log)</label>
          <textarea
            id={`${ids}-reason`}
            className="input"
            rows={3}
            maxLength={200}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="settings-status error" role="alert">
            {error ?? ''}
          </p>
          <div className="admin-actions">
            <button type="button" className="button small" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button
              type="submit"
              className={`button small ${danger ? 'danger' : 'primary'}`}
              disabled={busy}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
