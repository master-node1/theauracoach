import type { Metadata } from 'next';
import { currentMe } from '@/lib/server-session';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function TodayPage() {
  const me = await currentMe();
  const timeZone = me?.timezone ?? 'Asia/Kolkata';
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
  );
  const name = me?.displayName ?? null;

  return (
    <>
      <header>
        <div className="page-date">{date}</div>
        <h1 className="page-title">
          {greeting(hour)}
          {name ? `, ${name}` : ''}
        </h1>
      </header>
      {me ? (
        <section className="card hero" aria-labelledby="today-empty">
          <h2 id="today-empty">Your plan starts here</h2>
          <p>
            Signed in as <strong data-testid="me-email">{me.email}</strong>. Workouts, meals and
            your coach will show up on this page once you finish setting up.
          </p>
        </section>
      ) : (
        <section className="card warning" role="alert">
          <h2>We couldn&apos;t load your profile</h2>
          <p>Check your connection and refresh the page.</p>
        </section>
      )}
    </>
  );
}
