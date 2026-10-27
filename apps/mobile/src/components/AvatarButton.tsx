import { size } from '@aura/ui-tokens';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslations } from '../i18n';
import { useMe } from '../preferences';
import { usePalette } from '../theme';

/** The avatar that opens Settings, as in the designs. */
export function AvatarButton() {
  const p = usePalette();
  const { me } = useMe();
  const t = useTranslations('common');
  const initial = ((me?.displayName || me?.email || '?')[0] ?? '?').toUpperCase();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('settings')}
      onPress={() => router.push('/settings')}
      style={[styles.avatar, { backgroundColor: p['accent-soft'] }]}
      hitSlop={4}
    >
      <Text style={[styles.initial, { color: p['accent-text'] }]}>{initial}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: size.touchTarget - 4,
    height: size.touchTarget - 4,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 17, fontWeight: '800' },
});
