import type { Metadata } from 'next';
import Link from 'next/link';
import { config } from '@/lib/config';
import { AuthCard, ProviderButtons } from '../AuthCard';
import { SignUpForm } from '../AuthForms';

export const metadata: Metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  return (
    <AuthCard title="Create your account" lede="You must be 18 or older to use AuraCoach.">
      <ProviderButtons providers={config().identityProviders} returnTo="/" />
      <SignUpForm />
      <div className="auth-links">
        <span>Already have an account?</span>
        <Link href="/auth/sign-in">Sign in</Link>
      </div>
    </AuthCard>
  );
}
