import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { config } from '@/lib/config';
import { readPending } from '@/lib/email-auth';
import { AuthCard } from '../AuthCard';
import { VerifyForm } from '../AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verify');
  return { title: t('metaTitle') };
}
export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  const t = await getTranslations('auth.verify');
  const pending = await readPending(config(), (await headers()).get('cookie'));
  return (
    <AuthCard
      title={t('title')}
      lede={pending ? t('ledeEmail', { email: pending.email }) : t('lede')}
    >
      <VerifyForm initialEmail={pending?.email ?? ''} />
      <div className="auth-links">
        <Link href="/auth/sign-up">{t('differentEmail')}</Link>
      </div>
    </AuthCard>
  );
}
