import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '../AuthCard';
import { ForgotForm } from '../AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgot');
  return { title: t('title') };
}

export default async function ForgotPage() {
  const t = await getTranslations('auth.forgot');
  return (
    <AuthCard title={t('title')} lede={t('lede')}>
      <ForgotForm />
      <div className="auth-links">
        <Link href="/auth/sign-in">{t('back')}</Link>
      </div>
    </AuthCard>
  );
}
