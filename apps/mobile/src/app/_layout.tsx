import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { PendingDeletion } from '../components/privacy/PendingDeletion';
import { MeProvider, useFlags, useMe } from '../preferences';
import { useScheme } from '../theme';

function RootStack() {
  const { status } = useAuth();
  const scheme = useScheme();
  const { me } = useMe();
  const flags = useFlags();
  // Keep the native splash until the secure store has been read.
  if (status === 'loading') return null;
  const signedIn = status === 'signedIn';
  if (signedIn && me?.status === 'PENDING_DELETION') {
    // Everything else answers 423 now, so show only what still works: restore, export, sign out.
    return (
      <>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <PendingDeletion />
      </>
    );
  }
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Protected guard={flags.settings_v1}>
            <Stack.Screen name="settings" />
          </Stack.Protected>
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function SignedInData({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  return <MeProvider enabled={status === 'signedIn'}>{children}</MeProvider>;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SignedInData>
        <RootStack />
      </SignedInData>
    </AuthProvider>
  );
}
