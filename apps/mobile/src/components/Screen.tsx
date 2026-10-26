import { radius } from '@aura/ui-tokens';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette } from '../theme';

export function Screen({
  title,
  action,
  children,
}: {
  title: string;
  /** Shown at the right of the title, e.g. the avatar that opens Settings. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const p = usePalette();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
            {title}
          </Text>
          {action}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({
  title,
  body,
  tone = 'default',
  children,
}: {
  title: string;
  body?: string;
  tone?: 'default' | 'hero' | 'warning';
  children?: React.ReactNode;
}) {
  const p = usePalette();
  const bg = tone === 'hero' ? p.primary : tone === 'warning' ? p['warning-soft'] : p.surface;
  const fg = tone === 'hero' ? p['on-primary'] : p.text;
  const muted = tone === 'hero' ? p['on-primary'] : p['text-muted'];
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: bg, borderColor: tone === 'default' ? p.border : bg },
      ]}
    >
      <Text style={[styles.cardTitle, { color: fg }]}>{title}</Text>
      {body ? <Text style={[styles.cardBody, { color: muted }]}>{body}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 8 },
  card: { padding: 20, borderRadius: radius.cardLg, borderWidth: 1, gap: 6 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  cardBody: { fontSize: 15, lineHeight: 21 },
});
