import {
  ApiError,
  exportPollDelayMs,
  exportState,
  type DataRequestResponse,
} from '@aura/api-client';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApi } from '../../api';
import { usePalette } from '../../theme';

/**
 * "Export my data" (users LLD §3): starts an export, follows it until the zip is ready and opens
 * the 15-minute download link in the browser. Used in Settings and on the pending-deletion screen.
 */
export function ExportRow({ style }: { style?: object }) {
  const p = usePalette();
  const api = useApi();
  const [latest, setLatest] = useState<DataRequestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = exportState(latest);

  useEffect(() => {
    api
      .exports()
      .then(([first]) => setLatest(first ?? null))
      .catch(() => undefined);
  }, [api]);

  // While an export is being prepared, check on it with a growing interval.
  useEffect(() => {
    if (!latest || !state.busy) return;
    let attempt = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.getExport(latest.id);
        if (stopped) return;
        setLatest(next);
        if (!exportState(next).busy) return;
      } catch {
        // Keep trying; a blip should not end the wait.
      }
      timer = setTimeout(poll, exportPollDelayMs(++attempt));
    };
    timer = setTimeout(poll, exportPollDelayMs(attempt));
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, latest, state.busy]);

  const start = async () => {
    setError(null);
    try {
      setLatest(await api.requestExport());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EXPORT_IN_PROGRESS') {
        const [running] = await api.exports().catch(() => []);
        if (running) setLatest(running);
        return;
      }
      setError('Could not start the export. Check your connection and try again.');
    }
  };

  const download = state.downloadUrl;
  return (
    <View style={[styles.row, style]}>
      <View style={styles.flex}>
        <Text style={[styles.label, { color: p.text }]}>Export my data</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.small, { color: p['text-muted'] }]}>
          {error ?? state.label}
        </Text>
      </View>
      <Pressable
        accessibilityRole={download ? 'link' : 'button'}
        accessibilityState={{ disabled: state.busy }}
        disabled={state.busy}
        onPress={() => (download ? void Linking.openURL(download) : void start())}
        style={[styles.button, { borderColor: p.border }]}
      >
        <Text style={{ color: p.primary, fontWeight: '600' }}>
          {download ? 'Download' : state.busy ? 'Preparing…' : 'Export'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  label: { fontSize: 15, fontWeight: '500' },
  small: { fontSize: 14 },
  button: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
