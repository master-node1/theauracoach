import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '../AuthCard';
import { ForgotForm } from '../AuthForms';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPage() {
  return (
    <AuthCard
      title="Reset your password"
      lede="Enter your email. If it has an account, we'll send a code to reset the password."
    >
      <ForgotForm />
      <div className="auth-links">
        <Link href="/auth/sign-in">Back to sign in</Link>
      </div>
    </AuthCard>
  );
}
