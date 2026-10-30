import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { config } from '@/lib/config';
import { AuthCard, ProviderButtons } from '../AuthCard';
import { SignUpForm } from '../AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signUp');
  return { title: t('metaTitle') };
}
export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const t = await getTranslations('auth.signUp');
  return (
    <AuthCard title={t('title')} lede={t('lede')}>
      <ProviderButtons providers={config().identityProviders} returnTo="/" />
      <SignUpForm />
      <div className="auth-links">
        <span>{t('haveAccount')}</span>
        <Link href="/auth/sign-in">{t('signIn')}</Link>
      </div>
    </AuthCard>
  );
}
