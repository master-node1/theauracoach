import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'No access' };

export default function ForbiddenPage() {
  return (
    <main className="welcome">
      <div className="welcome-card">
        <h1>You don&apos;t have access to this page</h1>
        <p>The admin console is for AuraCoach staff. Ask an admin if you need a role.</p>
        <Link className="button" href="/">
          Back to Today
        </Link>
      </div>
    </main>
  );
}
