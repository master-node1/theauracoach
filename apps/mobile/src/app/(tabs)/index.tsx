import { Pressable, StyleSheet, Text } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { AvatarButton } from '../../components/AvatarButton';
import { Card, Screen } from '../../components/Screen';
import { appConfig } from '../../config';
import { useMe } from '../../preferences';
import { usePalette } from '../../theme';

export default function TodayScreen() {
  const p = usePalette();
  const { signOut } = useAuth();
  const { me, failed } = useMe();
  const settings = appConfig.features.settingsV1;

  return (
    <Screen title="Today" action={settings ? <AvatarButton /> : undefined}>
      {me ? (
        <Card
          tone="hero"
          title={
            me.displayName ? `Hi ${me.displayName}, your plan starts here` : 'Your plan starts here'
          }
          body={`Signed in as ${me.email}. Workouts, meals and your coach will show up here once you finish setting up.`}
        />
      ) : failed ? (
        <Card
          tone="warning"
          title="We couldn't load your profile"
          body="Check your connection and try again."
        />
      ) : null}
      {/* With Settings on, sign out lives there (W13). */}
      {!settings && (
        <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOut}>
          <Text style={{ color: p.primary, fontWeight: '600', fontSize: 15 }}>Sign out</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
});
