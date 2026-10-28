import {
  COACH_TONE_OPTIONS,
  CURRENT_POLICY_VERSION,
  SETTINGS_CONSENTS,
  THEME_OPTIONS,
  consentState,
  timeZoneOptions,
  type ConsentPurpose,
  type PreferencesResponse,
  type UnitSystem,
} from '@aura/api-client';
import { radius, size } from '@aura/ui-tokens';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { DeleteAccountRow } from '../components/privacy/DeleteAccountRow';
import { ExportRow } from '../components/privacy/ExportRow';
import { Card } from '../components/Screen';
import { useAppLocale, useTranslations } from '../i18n';
import { useFlags, useMe } from '../preferences';
import { saveOptimistically, type SaveStatus } from '../settings/optimistic';
import { usePalette } from '../theme';

const BACK = 'm15 18-6-6 6-6';
const APP_VERSION = '0.1';
const UNIT_SYSTEMS: readonly UnitSystem[] = ['METRIC', 'IMPERIAL'];
const channel = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

/** Settings (W13): account, app and privacy. Each change saves on its own and rolls back on failure. */
export default function SettingsScreen() {
  const p = usePalette();
  const t = useTranslations();
  const api = useApi();
  const { signOut, signOutEverywhere } = useAuth();
  const { me, failed, setTheme, reload } = useMe();
  const flags = useFlags();
  const [status, setStatus] = useState<SaveStatus | 'signOutEverywhereFailed'>(null);
  const [consentsFailed, setConsentsFailed] = useState(false);
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [zonesOpen, setZonesOpen] = useState(false);
  const [prefs, setPrefs] = useState<PreferencesResponse>({
    theme: 'system',
    coachTone: 'supportive',
  });
  const [units, setUnits] = useState<UnitSystem | null>(null);
  const [consents, setConsents] = useState<Record<ConsentPurpose, boolean> | null>(null);

  useEffect(() => {
    if (!me) return;
    setName(me.displayName ?? '');
    setSavedName(me.displayName ?? '');
    setTimezone(me.timezone);
    setPrefs(me.preferences);
    setUnits(me.profile?.unitSystem ?? null);
  }, [me]);

  useEffect(() => {
    api
      .consents()
      .then((list) => setConsents(consentState(list)))
      .catch(() => setConsentsFailed(true));
  }, [api]);

  const save = async (apply: () => void, undo: () => void, call: () => Promise<unknown>) => {
    setStatus(null);
    setStatus(await saveOptimistically(apply, undo, call));
  };

  const saveName = () => {
    const next = name.trim();
    if (!next || next === savedName) return;
    const before = savedName;
    void save(
      () => setSavedName(next),
      () => {
        setSavedName(before);
        setName(before);
      },
      () => api.updateProfile({ displayName: next }).then(reload),
    );
  };

  const changeTimezone = (next: string) => {
    const before = timezone;
    setZonesOpen(false);
    void save(
      () => setTimezone(next),
      () => setTimezone(before),
      () => api.updateProfile({ timezone: next }),
    );
  };

  const changePrefs = (update: Partial<PreferencesResponse>) => {
    const before = prefs;
    const next = { ...prefs, ...update };
    void save(
      () => {
        setPrefs(next);
        setTheme(next.theme);
      },
      () => {
        setPrefs(before);
        setTheme(before.theme);
      },
      () => api.updatePreferences(update),
    );
  };

  const changeUnits = (next: UnitSystem) => {
    const before = units;
    void save(
      () => setUnits(next),
      () => setUnits(before),
      () => api.updateProfile({ unitSystem: next }),
    );
  };

  const toggleConsent = (purpose: ConsentPurpose, granted: boolean) => {
    void save(
      () => setConsents((c) => c && { ...c, [purpose]: granted }),
      () => setConsents((c) => c && { ...c, [purpose]: !granted }),
      () => api.recordConsent({ purpose, granted, policyVersion: CURRENT_POLICY_VERSION, channel }),
    );
  };

  const failure =
    status === 'saved' ? null : (status ?? (consentsFailed ? ('consents' as const) : null));
  const text = { color: p.text };
  const muted = { color: p['text-muted'] };
  const list = [styles.list, { backgroundColor: p.surface, borderColor: p.border }];
  const row = [styles.row, { borderTopColor: p.border }];

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          style={styles.back}
        >
          <Icon path={BACK} color={p.text} size={22} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, text]}>
          {t('common.settings')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {failed && !me ? (
          <Card tone="warning" title={t('settings.loadFailed')} body={t('common.retryHint')} />
        ) : null}
        {me ? (
          <View style={[styles.summary, { backgroundColor: p.surface, borderColor: p.border }]}>
            <View style={[styles.avatar, { backgroundColor: p['accent-soft'] }]}>
              <Text style={[styles.avatarText, { color: p['accent-text'] }]}>
                {((savedName || me.email)[0] ?? '?').toUpperCase()}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text style={[styles.name, text]}>{savedName || t('settings.addName')}</Text>
              <Text style={[styles.small, muted]}>{t('settings.plan', { email: me.email })}</Text>
            </View>
          </View>
        ) : null}

        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={failure ? 'alert' : undefined}
          style={[styles.status, { color: failure ? p.danger : p.primary }]}
        >
          {failure
            ? t(
                failure === 'consents' || failure === 'signOutEverywhereFailed'
                  ? `settings.${failure === 'consents' ? 'consentsFailed' : failure}`
                  : `common.${failure}`,
              )
            : status === 'saved'
              ? t('common.saved')
              : ''}
        </Text>

        <Section title={t('settings.account')}>
          <View style={list}>
            <View style={[row, styles.firstRow, styles.column]}>
              <Text nativeID="display-name" style={[styles.label, text]}>
                {t('settings.displayName')}
              </Text>
              <View style={styles.inline}>
                <TextInput
                  accessibilityLabel={t('settings.displayName')}
                  accessibilityLabelledBy="display-name"
                  value={name}
                  onChangeText={setName}
                  maxLength={60}
                  autoComplete="name"
                  returnKeyType="done"
                  onSubmitEditing={saveName}
                  style={[
                    styles.input,
                    { color: p.text, borderColor: p.border, backgroundColor: p.bg },
                  ]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !name.trim() || name.trim() === savedName }}
                  disabled={!name.trim() || name.trim() === savedName}
                  onPress={saveName}
                  style={[styles.saveButton, { backgroundColor: p.primary }]}
                >
                  <Text style={{ color: p['on-primary'], fontWeight: '700' }}>
                    {t('common.save')}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View style={row}>
              <Text style={[styles.label, text]}>{t('settings.email')}</Text>
              <Text style={[styles.small, muted]}>{me?.email}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: zonesOpen }}
              accessibilityHint={t('settings.timeZoneHint')}
              onPress={() => setZonesOpen((o) => !o)}
              style={row}
            >
              <Text style={[styles.label, text]}>{t('settings.timeZone')}</Text>
              <Text style={[styles.small, muted]}>{timezone.replace(/_/g, ' ')}</Text>
            </Pressable>
            {zonesOpen &&
              timeZoneOptions(timezone).map((zone) => (
                <Pressable
                  key={zone}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: zone === timezone }}
                  onPress={() => changeTimezone(zone)}
                  style={[row, styles.option]}
                >
                  <Text style={[styles.small, zone === timezone ? { color: p.primary } : text]}>
                    {zone.replace(/_/g, ' ')}
                  </Text>
                </Pressable>
              ))}
          </View>
        </Section>

        <Section title={t('settings.app')}>
          <View style={list}>
            <View style={[row, styles.firstRow]}>
              <Text style={[styles.label, text]}>{t('settings.theme')}</Text>
              <Segmented
                label={t('settings.theme')}
                options={THEME_OPTIONS.map((value) => ({
                  value,
                  label: t(`settings.themes.${value}`),
                }))}
                value={prefs.theme}
                onChange={(theme) => changePrefs({ theme })}
              />
            </View>
            <View style={row}>
              <Text style={[styles.label, text]}>{t('settings.coachTone')}</Text>
              <Segmented
                label={t('settings.coachTone')}
                options={COACH_TONE_OPTIONS.map((value) => ({
                  value,
                  label: t(`settings.coachTones.${value}`),
                }))}
                value={prefs.coachTone}
                onChange={(coachTone) => changePrefs({ coachTone })}
              />
            </View>
            <View style={row}>
              <Text style={[styles.label, text]}>{t('settings.units')}</Text>
              {units ? (
                <Segmented
                  label={t('settings.units')}
                  options={UNIT_SYSTEMS.map((value) => ({
                    value,
                    label: t(`settings.unitSystems.${value}`),
                  }))}
                  value={units}
                  onChange={changeUnits}
                />
              ) : (
                <Text style={[styles.small, muted]}>{t('settings.unitsAfterSetup')}</Text>
              )}
            </View>
          </View>
        </Section>

        <Section title={t('settings.privacy')}>
          <View style={list}>
            <View style={[row, styles.firstRow]}>
              <View style={styles.flex}>
                <Text style={[styles.label, text]}>{t('settings.coreService')}</Text>
                <Text style={[styles.small, muted]}>{t('settings.coreServiceHint')}</Text>
              </View>
              <Text style={[styles.small, muted]}>{t('common.on')}</Text>
            </View>
            {SETTINGS_CONSENTS.map((purpose) => (
              <View key={purpose} style={row}>
                <View style={styles.flex}>
                  <Text style={[styles.label, text]}>
                    {t(`settings.consents.${purpose}.label`)}
                  </Text>
                  <Text style={[styles.small, muted]}>
                    {t(`settings.consents.${purpose}.description`)}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={t(`settings.consents.${purpose}.label`)}
                  accessibilityHint={t(`settings.consents.${purpose}.description`)}
                  disabled={!consents}
                  value={consents?.[purpose] ?? false}
                  onValueChange={(on) => toggleConsent(purpose, on)}
                  trackColor={{ true: p.primary, false: p.border }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}
            {flags.privacy_v1 ? (
              <>
                <ExportRow style={row} />
                <DeleteAccountRow style={row} />
              </>
            ) : (
              <>
                <View style={row}>
                  <Text style={[styles.label, text]}>{t('settings.exportData')}</Text>
                  <Text style={[styles.small, muted]}>{t('common.comingSoon')}</Text>
                </View>
                <View style={row}>
                  <Text style={[styles.label, { color: p.danger }]}>{t('settings.deleteAccount')}</Text>
                  <Text style={[styles.small, muted]}>{t('common.comingSoon')}</Text>
                </View>
              </>
            )}
          </View>
          <Text style={[styles.caption, muted]}>
            {t('settings.policyVersion', { version: CURRENT_POLICY_VERSION })}
          </Text>
        </Section>

        <Section title={t('settings.about')}>
          <View style={list}>
            <Pressable accessibilityRole="button" onPress={signOut} style={[row, styles.firstRow]}>
              <Text style={[styles.label, { color: p.primary }]}>{t('common.signOut')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t('settings.signOutEverywhereHint')}
              onPress={async () => {
                if (!(await signOutEverywhere())) {
                  setStatus('signOutEverywhereFailed');
                }
              }}
              style={row}
            >
              <Text style={[styles.label, { color: p.primary }]}>
                {t('settings.signOutEverywhere')}
              </Text>
            </Pressable>
          </View>
        </Section>

        <Text style={[styles.caption, styles.center, muted]}>
          {t('settings.footer', { version: APP_VERSION })}
          {'\n'}
          {t('settings.disclaimer')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const p = usePalette();
  const locale = useAppLocale();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: p['text-muted'] }]}>
        {title.toLocaleUpperCase(locale)}
      </Text>
      {children}
    </View>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const p = usePalette();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.segmented, { backgroundColor: p['surface-2'] }]}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => !selected && onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: p.surface }]}
          >
            <Text style={{ color: selected ? p.primary : p.text, fontWeight: '600' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  content: { padding: 16, paddingTop: 4, gap: 14 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.cardLg,
    borderWidth: 1,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '800' },
  name: { fontSize: 17, fontWeight: '700' },
  status: { minHeight: 18, fontSize: 14 },
  section: { gap: 6 },
  sectionTitle: { marginLeft: 4, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  list: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  firstRow: { borderTopWidth: 0 },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  option: { paddingLeft: 28 },
  inline: { flexDirection: 'row', gap: 8 },
  label: { fontSize: 15, fontWeight: '500' },
  small: { fontSize: 14 },
  caption: { fontSize: 12, marginLeft: 4 },
  center: { textAlign: 'center', lineHeight: 18 },
  input: {
    flex: 1,
    minHeight: size.touchTarget - 4,
    paddingHorizontal: 12,
    borderRadius: radius.input,
    borderWidth: 1,
    fontSize: 15,
  },
  saveButton: {
    minHeight: size.touchTarget - 4,
    paddingHorizontal: 16,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 12 },
  segment: { minHeight: 38, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center' },
});
