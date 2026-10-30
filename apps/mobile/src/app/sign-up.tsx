import type { IdentityErrorCode } from '@aura/api-client';
import { router } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  AuthScreen,
  ErrorText,
  Field,
  PrimaryButton,
  SecondaryButton,
  TextLink,
  usePasswordHint,
} from '../components/AuthForm';
import { appConfig } from '../config';
import { useTranslations } from '../i18n';

export default function SignUpScreen() {
  const { signIn, emailFlows } = useAuth();
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<IdentityErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = usePasswordHint(password);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.signUp(email, password);
    setBusy(false);
    if (result.kind === 'error') setError(result.code);
    else if (result.kind === 'next') {
      router.replace({ pathname: result.route, params: { email: result.email } });
    }
  }

  return (
    <AuthScreen title={t('signUp.title')} lede={t('signUp.lede')}>
      {appConfig.identityProviders.map((provider) => (
        <SecondaryButton
          key={provider}
          label={t(`providers.${provider}`)}
          onPress={() => void signIn(provider)}
        />
      ))}
      <Field label={t('fields.email')} kind="email" value={email} onChangeText={setEmail} />
      <Field
        label={t('fields.password')}
        kind="new-password"
        value={password}
        onChangeText={setPassword}
        hint={hint}
      />
      <ErrorText code={error} />
      <PrimaryButton
        label={busy ? t('signUp.busy') : t('signUp.submit')}
        busy={busy}
        onPress={submit}
      />
      <TextLink label={t('signUp.haveAccountLink')} onPress={() => router.replace('/sign-in')} />
    </AuthScreen>
  );
}
