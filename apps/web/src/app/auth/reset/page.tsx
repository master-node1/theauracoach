import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { config } from '@/lib/config';
import { readPending } from '@/lib/email-auth';
import { AuthCard } from '../AuthCard';
import { ResetForm } from '../AuthForms';

export const metadata: Metadata = { title: 'Choose a new password' };
export const dynamic = 'force-dynamic';

export default async function ResetPage() {
  const pending = await readPending(config(), (await headers()).get('cookie'));
  return (
    <AuthCard
      title="Choose a new password"
      lede="If the email has an account, a code is on its way. It works once, for 15 minutes."
    >
      <ResetForm initialEmail={pending?.email ?? ''} />
      <div className="auth-links">
        <Link href="/auth/forgot">Send a new code</Link>
        <Link href="/auth/sign-in">Back to sign in</Link>
      </div>
    </AuthCard>
  );
}
