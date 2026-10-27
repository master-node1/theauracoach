import { Pressable, StyleSheet, Text } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { AvatarButton } from '../../components/AvatarButton';
import { Card, Screen } from '../../components/Screen';
import { useTranslations } from '../../i18n';
import { useFlags, useMe } from '../../preferences';
import { usePalette } from '../../theme';

export default function TodayScreen() {
  const p = usePalette();
  const t = useTranslations();
  const { signOut } = useAuth();
  const { me, failed } = useMe();
  const settings = useFlags().settings_v1;

  return (
    <Screen title={t('nav.today')} action={settings ? <AvatarButton /> : undefined}>
      {me ? (
        <Card
          tone="hero"
          title={
            me.displayName
              ? t('today.emptyTitleNamed', { name: me.displayName })
              : t('today.emptyTitle')
          }
        >
          <Text style={[styles.body, { color: p['on-primary'] }]}>
            {t.rich('today.emptyBody', {
              email: me.email,
              strong: (chunks) => <Text style={styles.strong}>{chunks}</Text>,
            })}
          </Text>
        </Card>
      ) : failed ? (
        <Card tone="warning" title={t('today.profileFailed')} body={t('common.retryHint')} />
      ) : null}
      {/* With Settings on, sign out lives there (W13). */}
      {!settings && (
        <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOut}>
          <Text style={{ color: p.primary, fontWeight: '600', fontSize: 15 }}>
            {t('common.signOut')}
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  body: { fontSize: 15, lineHeight: 21 },
  strong: { fontWeight: '700' },
});
