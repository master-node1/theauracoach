import type { IdentityErrorCode } from '@aura/api-client';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AuthScreen, ErrorText, Field, PrimaryButton, TextLink } from '../components/AuthForm';
import { useTranslations } from '../i18n';

export default function ForgotScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { emailFlows } = useAuth();
  const t = useTranslations('auth');
  const [email, setEmail] = useState(params.email ?? '');
  const [error, setError] = useState<IdentityErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await emailFlows.forgot(email);
    setBusy(false);
    if (result.kind === 'error') setError(result.code);
    else if (result.kind === 'next') {
      router.replace({ pathname: result.route, params: { email: result.email } });
    }
  }

  return (
    <AuthScreen title={t('forgot.title')} lede={t('forgot.lede')}>
      <Field label={t('fields.email')} kind="email" value={email} onChangeText={setEmail} />
      <ErrorText code={error} />
      <PrimaryButton
        label={busy ? t('forgot.busy') : t('forgot.submit')}
        busy={busy}
        onPress={submit}
      />
      <TextLink label={t('forgot.back')} onPress={() => router.replace('/sign-in')} />
    </AuthScreen>
  );
}
