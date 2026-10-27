import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AuthScreen, ErrorText, Field, PrimaryButton, TextLink } from '../components/AuthForm';

export default function ForgotScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { emailFlows } = useAuth();
  const [email, setEmail] = useState(params.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.forgot(email);
    setBusy(false);
    if (result.kind === 'error') setError(result.message);
    else if (result.kind === 'next') {
      router.replace({ pathname: result.route, params: { email: result.email } });
    }
  }

  return (
    <AuthScreen
      title="Reset your password"
      lede="Enter your email. If it has an account, we'll send a code to reset the password."
    >
      <Field label="Email" kind="email" value={email} onChangeText={setEmail} />
      <ErrorText message={error} />
      <PrimaryButton label={busy ? 'Sending…' : 'Send reset code'} busy={busy} onPress={submit} />
      <TextLink label="Back to sign in" onPress={() => router.replace('/sign-in')} />
    </AuthScreen>
  );
}
