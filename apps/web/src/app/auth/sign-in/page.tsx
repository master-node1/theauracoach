import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { safeReturnTo } from '@/lib/csrf';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  state: 'That sign-in link expired. Please try again.',
  provider: 'Sign-in was cancelled or failed. Please try again.',
  tokens: 'We could not finish signing you in. Please try again.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const { returnTo, error } = await searchParams;
  const login = `/api/auth/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
  const message = error ? (ERRORS[error] ?? ERRORS.tokens) : null;
  return (
    <main className="welcome">
      <div className="welcome-card">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo size={56} />
        </div>
        <h1>Your trainer and nutrition coach, any time.</h1>
        <p>Workouts that fit your week and meals that fit your plate, from dal to dosa.</p>
        {message && (
          <div className="card warning" role="alert">
            <p>{message}</p>
          </div>
        )}
        <a className="button primary" href={login}>
          Continue
        </a>
        <p className="fine-print">Not medical advice · Privacy · Terms</p>
      </div>
    </main>
  );
}
