import type { IdentityErrorCode } from '@aura/api-client';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { isSignInNotice } from '../auth/email-flows';
import {
  AuthScreen,
  ErrorText,
  Field,
  PrimaryButton,
  SecondaryButton,
  TextLink,
} from '../components/AuthForm';
import { appConfig } from '../config';
import { useTranslations } from '../i18n';

export default function SignInScreen() {
  const params = useLocalSearchParams<{ email?: string; notice?: string }>();
  const { signIn, completeSignIn, emailFlows, error: hostedError } = useAuth();
  const t = useTranslations('auth');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<IdentityErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.signIn(email, password);
    setBusy(false);
    if (result.kind === 'signedIn') await completeSignIn(result.tokens);
    else if (result.kind === 'error') setError(result.code);
  }

  return (
    <AuthScreen
      title={t('headline')}
      lede={t('lede')}
      notice={isSignInNotice(params.notice) ? t(`notices.${params.notice}`) : undefined}
    >
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
        kind="password"
        value={password}
        onChangeText={setPassword}
      />
      <ErrorText code={error} message={hostedError ? t(`errors.${hostedError}`) : null} />
      {error === 'UserNotConfirmed' ? (
        <TextLink
          label={t('signIn.enterCode')}
          onPress={() => router.push({ pathname: '/verify', params: { email } })}
        />
      ) : null}
      <PrimaryButton
        label={busy ? t('signIn.busy') : t('signIn.submit')}
        busy={busy}
        onPress={submit}
      />
      <TextLink label={t('signIn.createAccount')} onPress={() => router.push('/sign-up')} />
      <TextLink
        label={t('signIn.forgot')}
        onPress={() => router.push({ pathname: '/forgot', params: { email } })}
      />
      <TextLink label={t('signIn.moreOptions')} onPress={() => void signIn()} />
    </AuthScreen>
  );
}
