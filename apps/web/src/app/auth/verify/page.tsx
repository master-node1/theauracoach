import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { config } from '@/lib/config';
import { readPending } from '@/lib/email-auth';
import { AuthCard } from '../AuthCard';
import { VerifyForm } from '../AuthForms';

export const metadata: Metadata = { title: 'Confirm your email' };
export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  const pending = await readPending(config(), (await headers()).get('cookie'));
  return (
    <AuthCard
      title="Check your email"
      lede={
        pending
          ? `We sent a 6-digit code to ${pending.email}.`
          : 'Enter your email and the 6-digit code we sent you.'
      }
    >
      <VerifyForm initialEmail={pending?.email ?? ''} />
      <div className="auth-links">
        <Link href="/auth/sign-up">Use a different email</Link>
      </div>
    </AuthCard>
  );
}
