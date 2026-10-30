import { formatDate } from '@aura/i18n';
import { radius, size } from '@aura/ui-tokens';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApi } from '../../api';
import { useAuth } from '../../auth/AuthProvider';
import { useAppLocale, useTranslations } from '../../i18n';
import { useMe } from '../../preferences';
import { usePalette } from '../../theme';
import { ExportRow } from './ExportRow';

/**
 * Shown instead of the app while the account waits out its deletion grace period: restore it,
 * download a copy, or sign out (users LLD §4, TC-PRV-3). Everything else answers 423 now.
 */
export function PendingDeletion() {
  const p = usePalette();
  const api = useApi();
  const { signOut } = useAuth();
  const { me, reload } = useMe();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = useTranslations();
  const locale = useAppLocale();
  const due = me?.deletionDueAt;

  const restore = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await api.restoreAccount();
      await reload();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const text = { color: p.text };
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, text]}>
          {t('privacy.pending.title')}
        </Text>
        <Text style={[styles.body, text]}>
          {due
            ? t('privacy.pending.body', {
                date: formatDate(new Date(due), {
                  locale,
                  timeZone: me?.timezone ?? 'Asia/Kolkata',
                }),
              })
            : t('privacy.pending.bodySoon')}
        </Text>
        {failed ? (
          <Text accessibilityRole="alert" style={[styles.body, { color: p.danger }]}>
            {t('privacy.pending.failed')}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void restore()}
          style={[styles.primary, { backgroundColor: p.primary }]}
        >
          <Text style={[styles.buttonText, { color: p['on-primary'] }]}>
            {busy ? t('privacy.pending.busy') : t('privacy.pending.restore')}
          </Text>
        </Pressable>
        <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}>
          <ExportRow />
        </View>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.link}>
          <Text style={[styles.buttonText, { color: p.primary }]}>{t('common.signOut')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 22 },
  primary: {
    minHeight: size.touchTarget,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  card: { padding: 14, borderRadius: 14, borderWidth: 1 },
  link: { minHeight: size.touchTarget, alignItems: 'center', justifyContent: 'center' },
});
