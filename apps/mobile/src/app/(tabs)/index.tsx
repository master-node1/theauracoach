import type { MeResponse } from '@aura/api-client';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useApi } from '../../api';
import { useAuth } from '../../auth/AuthProvider';
import { Card, Screen } from '../../components/Screen';
import { usePalette } from '../../theme';

export default function TodayScreen() {
  const api = useApi();
  const p = usePalette();
  const { signOut } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setFailed(true));
  }, [api]);

  return (
    <Screen title="Today">
      {me ? (
        <Card
          tone="hero"
          title="Your plan starts here"
          body={`Signed in as ${me.email}. Workouts, meals and your coach will show up here once you finish setting up.`}
        />
      ) : failed ? (
        <Card
          tone="warning"
          title="We couldn't load your profile"
          body="Check your connection and try again."
        />
      ) : null}
      <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOut}>
        <Text style={{ color: p.primary, fontWeight: '600', fontSize: 15 }}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
});
