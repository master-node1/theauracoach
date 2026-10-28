'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GrantableRole } from '@aura/contracts';
import { browserApi } from '@/lib/browser-api';
import { actionErrorText, ReasonDialog } from './ReasonDialog';

/** Grants a role by email, with a reason for the audit log. */
export function GrantRoleForm({ roles }: { roles: GrantableRole[] }) {
  const ids = useId();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GrantableRole>(roles[0]!);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await browserApi.request('/v1/admin/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role, reason: reason.trim() }),
      });
      setStatus({ kind: 'ok', text: `Granted ${role} to ${email.trim()}.` });
      setEmail('');
      setReason('');
      router.refresh();
    } catch (err) {
      setStatus({ kind: 'error', text: actionErrorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form inline" onSubmit={submit} aria-label="Grant a role">
      <div className="field">
        <label htmlFor={`${ids}-email`}>Email</label>
        <input
          id={`${ids}-email`}
          className="input"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-role`}>Role</label>
        <select
          id={`${ids}-role`}
          className="input"
          value={role}
          onChange={(e) => setRole(e.target.value as GrantableRole)}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="field grow">
        <label htmlFor={`${ids}-reason`}>Reason</label>
        <input
          id={`${ids}-reason`}
          className="input"
          required
          minLength={3}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <button type="submit" className="button small primary" disabled={busy}>
        {busy ? 'Granting…' : 'Grant role'}
      </button>
      <p className={`settings-status${status?.kind === 'error' ? ' error' : ''}`} role="status">
        {status?.text ?? ''}
      </p>
    </form>
  );
}

export function RevokeRoleButton({
  userId,
  email,
  role,
}: {
  userId: string;
  email: string;
  role: GrantableRole;
}) {
  const router = useRouter();
  return (
    <ReasonDialog
      label="Revoke"
      title={`Revoke ${role}`}
      description={`${email} loses ${role} at their next token refresh (within 15 minutes).`}
      confirmLabel="Revoke role"
      danger
      onConfirm={async (reason) => {
        await browserApi.request(
          `/v1/admin/roles/${encodeURIComponent(userId)}/${encodeURIComponent(role)}?reason=${encodeURIComponent(reason)}`,
          { method: 'DELETE' },
        );
        router.refresh();
      }}
    />
  );
}
