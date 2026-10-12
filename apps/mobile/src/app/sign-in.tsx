import { radius, size } from '@aura/ui-tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Icon';
import { usePalette } from '../theme';

export default function SignInScreen() {
  const p = usePalette();
  const { signIn, error } = useAuth();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]}>
      <View style={styles.body}>
        <Logo primary={p.primary} accent={p.accent} />
        <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
          Your trainer and nutrition coach, any time.
        </Text>
        <Text style={[styles.lede, { color: p['text-muted'] }]}>
          Workouts that fit your week and meals that fit your plate, from dal to dosa.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: p.danger }]}>
            {error}
          </Text>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={signIn}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: p.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: p['on-primary'] }]}>Continue</Text>
        </Pressable>
        <Text style={[styles.fine, { color: p['text-muted'] }]}>
          Not medical advice · Privacy · Terms
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, padding: 24 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  lede: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  error: { fontSize: 15, textAlign: 'center' },
  footer: { gap: 12 },
  button: {
    minHeight: size.touchTarget,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  fine: { fontSize: 12, textAlign: 'center' },
});
