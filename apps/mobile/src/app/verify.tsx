import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  AuthScreen,
  ErrorText,
  Field,
  PrimaryButton,
  SecondaryButton,
  TextLink,
} from '../components/AuthForm';

export default function VerifyScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { completeSignIn, emailFlows } = useAuth();
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.verify(email, code);
    setBusy(false);
    if (result.kind === 'signedIn') await completeSignIn(result.tokens);
    else if (result.kind === 'next') {
      router.replace({
        pathname: result.route,
        params: { email: result.email, ...(result.notice ? { notice: result.notice } : {}) },
      });
    } else setError(result.message);
  }

  async function resend() {
    setError(null);
    setNotice(undefined);
    const result = await emailFlows.resend(email);
    if (result?.kind === 'error') setError(result.message);
    else setNotice('We sent a new code. The old one no longer works.');
  }

  return (
    <AuthScreen
      title="Check your email"
      lede={
        params.email
          ? `We sent a 6-digit code to ${params.email}.`
          : 'Enter the 6-digit code we sent you.'
      }
      notice={notice}
    >
      <Field label="Email" kind="email" value={email} onChangeText={setEmail} />
      <Field
        label="Code"
        kind="code"
        value={code}
        onChangeText={setCode}
        hint="It works for 15 minutes."
      />
      <ErrorText message={error} />
      <PrimaryButton label={busy ? 'Checking…' : 'Verify email'} busy={busy} onPress={submit} />
      <SecondaryButton label="Send a new code" onPress={resend} disabled={!email} />
      <TextLink label="Use a different email" onPress={() => router.replace('/sign-up')} />
    </AuthScreen>
  );
}
