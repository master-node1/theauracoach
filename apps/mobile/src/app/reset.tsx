import { passwordHint } from '@aura/api-client';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AuthScreen, ErrorText, Field, PrimaryButton, TextLink } from '../components/AuthForm';

const POLICY = 'At least 10 characters, with upper- and lower-case letters and a number.';

export default function ResetScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { emailFlows } = useAuth();
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.reset(email, code, password);
    setBusy(false);
    if (result.kind === 'error') setError(result.message);
    else if (result.kind === 'next') {
      router.replace({
        pathname: result.route,
        params: { email: result.email, ...(result.notice ? { notice: result.notice } : {}) },
      });
    }
  }

  return (
    <AuthScreen
      title="Choose a new password"
      lede="If the email has an account, a code is on its way. It works once, for 15 minutes."
    >
      <Field label="Email" kind="email" value={email} onChangeText={setEmail} />
      <Field label="Code" kind="code" value={code} onChangeText={setCode} />
      <Field
        label="New password"
        kind="new-password"
        value={password}
        onChangeText={setPassword}
        hint={(password && passwordHint(password)) || POLICY}
      />
      <ErrorText message={error} />
      <PrimaryButton label={busy ? 'Saving…' : 'Set new password'} busy={busy} onPress={submit} />
      <TextLink
        label="Send a new code"
        onPress={() => router.replace({ pathname: '/forgot', params: { email } })}
      />
    </AuthScreen>
  );
}
