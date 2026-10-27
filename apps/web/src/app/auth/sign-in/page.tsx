import type { Metadata } from 'next';
import Link from 'next/link';
import { config } from '@/lib/config';
import { safeReturnTo } from '@/lib/csrf';
import { AuthCard, ProviderButtons } from '../AuthCard';
import { SignInForm } from '../AuthForms';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  state: 'That sign-in link expired. Please try again.',
  provider: 'Sign-in was cancelled or failed. Please try again.',
  tokens: 'We could not finish signing you in. Please try again.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string; verified?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const notice = params.error
    ? { text: ERRORS[params.error] ?? (ERRORS.tokens as string), tone: 'warning' as const }
    : params.verified
      ? { text: 'Your email is confirmed. Sign in to continue.', tone: 'info' as const }
      : params.reset
        ? { text: 'Your password is changed. Sign in with the new one.', tone: 'info' as const }
        : null;
  return (
    <AuthCard
      title="Your trainer and nutrition coach, any time."
      lede="Workouts that fit your week and meals that fit your plate, from dal to dosa."
      notice={notice}
    >
      <ProviderButtons providers={config().identityProviders} returnTo={returnTo} />
      <SignInForm returnTo={returnTo} />
      <div className="auth-links">
        <Link href="/auth/sign-up">Create an account</Link>
        <Link href="/auth/forgot">Forgot password?</Link>
        <a href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
          More sign-in options
        </a>
      </div>
    </AuthCard>
  );
}
