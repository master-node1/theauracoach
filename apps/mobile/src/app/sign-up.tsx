import { passwordHint } from '@aura/api-client';
import { router } from 'expo-router';
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

const POLICY = 'At least 10 characters, with upper- and lower-case letters and a number.';

export default function SignUpScreen() {
  const { signIn, emailFlows } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.signUp(email, password);
    setBusy(false);
    if (result.kind === 'error') setError(result.message);
    else if (result.kind === 'next') {
      router.replace({ pathname: result.route, params: { email: result.email } });
    }
  }

  return (
    <AuthScreen title="Create your account" lede="You must be 18 or older to use AuraCoach.">
      {appConfig.identityProviders.map((provider) => (
        <SecondaryButton
          key={provider}
          label={IDENTITY_PROVIDER_LABELS[provider]}
          onPress={() => void signIn(provider)}
        />
      ))}
      <Field label="Email" kind="email" value={email} onChangeText={setEmail} />
      <Field
        label="Password"
        kind="new-password"
        value={password}
        onChangeText={setPassword}
        hint={(password && passwordHint(password)) || POLICY}
      />
      <ErrorText message={error} />
      <PrimaryButton
        label={busy ? 'Creating account…' : 'Create account'}
        busy={busy}
        onPress={submit}
      />
      <TextLink
        label="Already have an account? Sign in"
        onPress={() => router.replace('/sign-in')}
      />
    </AuthScreen>
  );
}
