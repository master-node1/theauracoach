import { DELETE_ACCOUNT_COPY, DELETE_CONFIRMATION, deletionConfirmed } from '@aura/api-client';
import { radius, size } from '@aura/ui-tokens';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApi } from '../../api';
import { useAuth } from '../../auth/AuthProvider';
import { useMe } from '../../preferences';
import { deleteWithReauth } from '../../settings/privacy';
import { usePalette } from '../../theme';

/**
 * "Delete account": a confirmation sheet (type DELETE), then DELETE /v1/me, signing in again
 * first when the API wants a fresher sign-in. Afterwards the app shows the pending-deletion screen.
 */
export function DeleteAccountRow({ style }: { style?: object }) {
  const p = usePalette();
  const api = useApi();
  const { reauthenticate } = useAuth();
  const { reload } = useMe();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setTyped('');
    setError(null);
  };

  const confirm = async () => {
    if (!deletionConfirmed(typed)) return;
    setBusy(true);
    setError(null);
    const outcome = await deleteWithReauth(() => api.deleteAccount(), reauthenticate);
    setBusy(false);
    if (outcome.kind === 'scheduled') {
      close();
      await reload();
    } else if (outcome.kind === 'error') {
      setError(outcome.text);
    }
  };

  const text = { color: p.text };
  const muted = { color: p['text-muted'] };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Locks the account now and erases it after 30 days"
        onPress={() => setOpen(true)}
        style={[styles.row, style]}
      >
        <Text style={[styles.label, { color: p.danger }]}>Delete account</Text>
        <Text style={[styles.small, muted]}>Erased after 30 days</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: p.surface, borderColor: p.border }]}
          >
            <Text accessibilityRole="header" style={[styles.title, text]}>
              {DELETE_ACCOUNT_COPY.title}
            </Text>
            <Text style={[styles.small, text]}>{DELETE_ACCOUNT_COPY.body}</Text>
            <Text style={[styles.small, muted]}>{DELETE_ACCOUNT_COPY.exportHint}</Text>
            <Text style={[styles.small, muted]}>{DELETE_ACCOUNT_COPY.reauth}</Text>
            <Text nativeID="delete-confirm" style={[styles.label, text]}>
              Type {DELETE_CONFIRMATION} to confirm
            </Text>
            <TextInput
              accessibilityLabel={`Type ${DELETE_CONFIRMATION} to confirm`}
              accessibilityLabelledBy="delete-confirm"
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              style={[
                styles.input,
                { color: p.text, borderColor: p.border, backgroundColor: p.bg },
              ]}
            />
            {error ? (
              <Text accessibilityRole="alert" style={[styles.small, { color: p.danger }]}>
                {error}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={close}
                style={[styles.button, { borderColor: p.border }]}
              >
                <Text style={[styles.label, text]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || !deletionConfirmed(typed) }}
                disabled={busy || !deletionConfirmed(typed)}
                onPress={() => void confirm()}
                style={[
                  styles.button,
                  { backgroundColor: p.danger, borderColor: p.danger },
                  (busy || !deletionConfirmed(typed)) && styles.disabled,
                ]}
              >
                <Text style={[styles.label, { color: '#FFFFFF' }]}>
                  {busy ? 'Deleting…' : 'Delete account'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 14, lineHeight: 20 },
  title: { fontSize: 18, fontWeight: '800' },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: { gap: 10, padding: 20, borderRadius: radius.cardLg, borderWidth: 1 },
  input: {
    minHeight: size.touchTarget,
    paddingHorizontal: 12,
    borderRadius: radius.input,
    borderWidth: 1,
    fontSize: 16,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  button: {
    minHeight: size.touchTarget,
    paddingHorizontal: 16,
    borderRadius: radius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
});
