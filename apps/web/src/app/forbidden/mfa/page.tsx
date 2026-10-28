import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Two-step verification needed' };

/** Shown for /admin, and for admin API answers of 403 MFA_REQUIRED, to staff signed in without MFA. */
export default function MfaRequiredPage() {
  return (
    <main className="welcome">
      <div className="welcome-card">
        <h1>Sign in with two-step verification</h1>
        <p>
          The admin console needs a sign-in that used your authenticator app. Sign in again and
          enter the code from the app when asked.
        </p>
        <Link className="button" href="/auth/sign-in?returnTo=/admin">
          Sign in again
        </Link>
        <p>
          <Link href="/">Back to Today</Link>
        </p>
      </div>
    </main>
  );
}
