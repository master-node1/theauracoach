import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { IDENTITY_PROVIDER_LABELS } from '../auth/email-flows';
import {
  AuthScreen,
  ErrorText,
  Field,
  PrimaryButton,
  SecondaryButton,
  TextLink,
} from '../components/AuthForm';
import { appConfig } from '../config';

export default function SignInScreen() {
  const params = useLocalSearchParams<{ email?: string; notice?: string }>();
  const { signIn, completeSignIn, emailFlows, error: hostedError } = useAuth();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.signIn(email, password);
    setBusy(false);
    if (result.kind === 'signedIn') await completeSignIn(result.tokens);
    else if (result.kind === 'error') setError(result);
  }

  return (
    <AuthScreen
      title="Your trainer and nutrition coach, any time."
      lede="Workouts that fit your week and meals that fit your plate, from dal to dosa."
      notice={params.notice}
    >
      {appConfig.identityProviders.map((provider) => (
        <SecondaryButton
          key={provider}
          label={IDENTITY_PROVIDER_LABELS[provider]}
          onPress={() => void signIn(provider)}
        />
      ))}
      <Field label="Email" kind="email" value={email} onChangeText={setEmail} />
      <Field label="Password" kind="password" value={password} onChangeText={setPassword} />
      <ErrorText message={error?.message ?? hostedError} />
      {error?.code === 'UserNotConfirmed' ? (
        <TextLink
          label="Enter your code"
          onPress={() => router.push({ pathname: '/verify', params: { email } })}
        />
      ) : null}
      <PrimaryButton label={busy ? 'Signing in…' : 'Sign in'} busy={busy} onPress={submit} />
      <TextLink label="Create an account" onPress={() => router.push('/sign-up')} />
      <TextLink
        label="Forgot password?"
        onPress={() => router.push({ pathname: '/forgot', params: { email } })}
      />
      <TextLink label="More sign-in options" onPress={() => void signIn()} />
    </AuthScreen>
  );
}
