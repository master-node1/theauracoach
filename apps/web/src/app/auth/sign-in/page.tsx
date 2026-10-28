import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { config } from '@/lib/config';
import { safeReturnTo } from '@/lib/csrf';
import { AuthCard, ProviderButtons } from '../AuthCard';
import { SignInForm } from '../AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signInTitle') };
}
export const dynamic = 'force-dynamic';

const ERRORS = ['state', 'provider', 'tokens'] as const;
type SignInError = (typeof ERRORS)[number];
const isSignInError = (v: string): v is SignInError => (ERRORS as readonly string[]).includes(v);

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string; verified?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations('auth');
  const returnTo = safeReturnTo(params.returnTo);
  const notice = params.error
    ? {
        text: t(`errors.${isSignInError(params.error) ? params.error : 'tokens'}`),
        tone: 'warning' as const,
      }
    : params.verified
      ? { text: t('notices.verified'), tone: 'info' as const }
      : params.reset
        ? { text: t('notices.passwordChanged'), tone: 'info' as const }
        : null;
  return (
    <AuthCard title={t('headline')} lede={t('lede')} notice={notice}>
      <ProviderButtons providers={config().identityProviders} returnTo={returnTo} />
      <SignInForm returnTo={returnTo} />
      <div className="auth-links">
        <Link href="/auth/sign-up">{t('signIn.createAccount')}</Link>
        <Link href="/auth/forgot">{t('signIn.forgot')}</Link>
        <a href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
          {t('signIn.moreOptions')}
        </a>
      </div>
    </AuthCard>
  );
}
