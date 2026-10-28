import { PASSWORD_POLICY, passwordIssues, type IdentityErrorCode } from '@aura/api-client';
import { formatList } from '@aura/i18n';
import { radius, size } from '@aura/ui-tokens';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppLocale, useTranslations } from '../i18n';
import { usePalette } from '../theme';
import { Logo } from './Icon';

/** Shared frame and controls for the sign-in, sign-up, verify and reset screens (TAC-8). */
export function AuthScreen(props: {
  title: string;
  lede?: string;
  notice?: string | undefined;
  children: ReactNode;
}) {
  const p = usePalette();
  const t = useTranslations('common');
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <Logo primary={p.primary} accent={p.accent} />
            <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
              {props.title}
            </Text>
            {props.lede ? (
              <Text style={[styles.lede, { color: p['text-muted'] }]}>{props.lede}</Text>
            ) : null}
            {props.notice ? (
              <Text accessibilityLiveRegion="polite" style={[styles.lede, { color: p.primary }]}>
                {props.notice}
              </Text>
            ) : null}
          </View>
          <View style={styles.form}>{props.children}</View>
          <Text style={[styles.fine, { color: p['text-muted'] }]}>{t('legalLinks')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  kind: 'email' | 'password' | 'new-password' | 'code';
  hint?: string | null;
}) {
  const p = usePalette();
  const common = {
    email: { keyboardType: 'email-address' as const, autoComplete: 'email' as const },
    password: { secureTextEntry: true, autoComplete: 'current-password' as const },
    'new-password': { secureTextEntry: true, autoComplete: 'new-password' as const },
    code: {
      keyboardType: 'number-pad' as const,
      autoComplete: 'one-time-code' as const,
      maxLength: 6,
    },
  }[props.kind];
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: p.text }]}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        accessibilityHint={props.hint ?? undefined}
        value={props.value}
        onChangeText={props.onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        {...common}
        style={[styles.input, { color: p.text, borderColor: p.border, backgroundColor: p.surface }]}
      />
      {props.hint ? (
        <Text style={[styles.hint, { color: p['text-muted'] }]}>{props.hint}</Text>
      ) : null}
    </View>
  );
}

const MIN = PASSWORD_POLICY.minLength;

/** What the password still needs, or the policy when it is empty or already fine. */
export function usePasswordHint(password: string): string {
  const t = useTranslations('auth.password');
  const locale = useAppLocale();
  const issues = passwordIssues(password);
  if (!password || issues.length === 0) return t('policy', { min: MIN });
  if (issues.includes('tooLong')) return t('tooLong');
  const list = formatList(
    issues.map((issue) => t(`issues.${issue as Exclude<typeof issue, 'tooLong'>}`, { min: MIN })),
    { locale },
  );
  return t('hint', { list });
}

/** An identity error code in words, or a message that is already words (hosted sign-in). */
export function ErrorText({
  code,
  message,
}: {
  code?: IdentityErrorCode | null;
  message?: string | null;
}) {
  const p = usePalette();
  const t = useTranslations('auth.identityErrors');
  const text = code ? t(code, { min: MIN }) : message;
  if (!text) return null;
  return (
    <Text accessibilityRole="alert" style={[styles.hint, { color: p.danger }]}>
      {text}
    </Text>
  );
}

export function PrimaryButton(props: { label: string; onPress: () => void; busy?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: !!props.busy, disabled: !!props.busy }}
      disabled={props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: p.primary, opacity: pressed || props.busy ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: p['on-primary'] }]}>{props.label}</Text>
    </Pressable>
  );
}

export function SecondaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        { borderWidth: 1, borderColor: p.border, opacity: pressed || props.disabled ? 0.6 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: p.text }]}>{props.label}</Text>
    </Pressable>
  );
}

export function TextLink(props: { label: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="link" onPress={props.onPress} hitSlop={8} style={styles.link}>
      <Text style={[styles.linkText, { color: p.primary }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, padding: 24, gap: 24, justifyContent: 'center' },
  head: { alignItems: 'center', gap: 12 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  lede: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  form: { gap: 14 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    minHeight: size.touchTarget,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  hint: { fontSize: 13, lineHeight: 18 },
  button: {
    minHeight: size.touchTarget,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  link: { alignSelf: 'center', paddingVertical: 4 },
  linkText: { fontSize: 15, fontWeight: '600' },
  fine: { fontSize: 12, textAlign: 'center' },
});
