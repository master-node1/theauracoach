import { AUTH_CODE_TTL_SECONDS, type IdentityErrorCode } from '@aura/api-client';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  AuthScreen,
  ErrorText,
  Field,
  PrimaryButton,
  TextLink,
  usePasswordHint,
} from '../components/AuthForm';
import { useTranslations } from '../i18n';

export default function ResetScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { emailFlows } = useAuth();
  const t = useTranslations('auth');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<IdentityErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = usePasswordHint(password);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.reset(email, code, password);
    setBusy(false);
    if (result.kind === 'error') setError(result.code);
    else if (result.kind === 'next') {
      router.replace({
        pathname: result.route,
        params: { email: result.email, ...(result.notice ? { notice: result.notice } : {}) },
      });
    }
  }

  return (
    <AuthScreen
      title={t('reset.title')}
      lede={t('reset.lede', { minutes: AUTH_CODE_TTL_SECONDS / 60 })}
    >
      <Field label={t('fields.email')} kind="email" value={email} onChangeText={setEmail} />
      <Field label={t('fields.code')} kind="code" value={code} onChangeText={setCode} />
      <Field
        label={t('fields.newPassword')}
        kind="new-password"
        value={password}
        onChangeText={setPassword}
        hint={hint}
      />
      <ErrorText code={error} />
      <PrimaryButton
        label={busy ? t('reset.busy') : t('reset.submit')}
        busy={busy}
        onPress={submit}
      />
      <TextLink
        label={t('reset.resend')}
        onPress={() => router.replace({ pathname: '/forgot', params: { email } })}
      />
    </AuthScreen>
  );
}
