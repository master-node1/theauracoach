import { AUTH_CODE_TTL_SECONDS } from '@aura/api-client';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { config } from '@/lib/config';
import { readPending } from '@/lib/email-auth';
import { AuthCard } from '../AuthCard';
import { ResetForm } from '../AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.reset');
  return { title: t('title') };
}
export const dynamic = 'force-dynamic';

export default async function ResetPage() {
  const t = await getTranslations('auth.reset');
  const pending = await readPending(config(), (await headers()).get('cookie'));
  return (
    <AuthCard title={t('title')} lede={t('lede', { minutes: AUTH_CODE_TTL_SECONDS / 60 })}>
      <ResetForm initialEmail={pending?.email ?? ''} />
      <div className="auth-links">
        <Link href="/auth/forgot">{t('resend')}</Link>
        <Link href="/auth/sign-in">{t('back')}</Link>
      </div>
    </AuthCard>
  );
}
