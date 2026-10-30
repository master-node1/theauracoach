import { AUTH_CODE_TTL_SECONDS, type IdentityErrorCode } from '@aura/api-client';
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
import { useTranslations } from '../i18n';

export default function VerifyScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { completeSignIn, emailFlows } = useAuth();
  const t = useTranslations('auth');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<IdentityErrorCode | null>(null);
  const [resent, setResent] = useState(false);
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
    } else setError(result.code);
  }

  async function resend() {
    setError(null);
    setResent(false);
    const result = await emailFlows.resend(email);
    if (result?.kind === 'error') setError(result.code);
    else setResent(true);
  }

  return (
    <AuthScreen
      title={t('verify.title')}
      lede={params.email ? t('verify.ledeEmail', { email: params.email }) : t('verify.lede')}
      notice={resent ? t('notices.codeResent') : undefined}
    >
      <Field label={t('fields.email')} kind="email" value={email} onChangeText={setEmail} />
      <Field
        label={t('fields.code')}
        kind="code"
        value={code}
        onChangeText={setCode}
        hint={t('codeHint', { minutes: AUTH_CODE_TTL_SECONDS / 60 })}
      />
      <ErrorText code={error} />
      <PrimaryButton
        label={busy ? t('verify.busy') : t('verify.submit')}
        busy={busy}
        onPress={submit}
      />
      <SecondaryButton label={t('verify.resend')} onPress={resend} disabled={!email} />
      <TextLink label={t('verify.differentEmail')} onPress={() => router.replace('/sign-up')} />
    </AuthScreen>
  );
}
