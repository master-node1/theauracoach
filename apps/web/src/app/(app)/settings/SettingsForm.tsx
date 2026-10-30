'use client';

import { useId, useState } from 'react';
import {
  ApiError,
  COACH_TONE_OPTIONS,
  SETTINGS_CONSENTS,
  THEME_OPTIONS,
  consentState,
  timeZoneOptions,
  type ConsentPurpose,
  type ConsentResponse,
  type DataRequestResponse,
  type MeResponse,
  type PreferencesResponse,
  type ProfileResponse,
  type UnitSystem,
} from '@aura/api-client';
import { DeleteAccount } from '@/components/privacy/DeleteAccount';
import { ExportData } from '@/components/privacy/ExportData';
import { browserApi } from '@/lib/browser-api';
import { applyTheme } from '@/lib/theme';

type Status = { kind: 'saved' | 'error'; text: string } | null;

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.status === 422) return 'Please check the value and try again.';
  return 'Could not save. Check your connection and try again.';
}

const DIET_LABELS: Record<ProfileResponse['dietType'], string> = {
  VEGETARIAN: 'Vegetarian',
  EGGETARIAN: 'Eggetarian',
  NON_VEGETARIAN: 'Non-vegetarian',
  VEGAN: 'Vegan',
  JAIN: 'Jain',
  PESCATARIAN: 'Pescatarian',
};

const readable = (code: string) => code.replace(/_/g, ' ');

/**
 * Settings (W13): account, app and privacy. Every change saves on its own and is shown at once;
 * a failed save puts the old value back and says so.
 */
export function SettingsForm({
  me,
  consents: initialConsents,
  policyVersion,
  privacy,
}: {
  me: MeResponse;
  consents: ConsentResponse[];
  policyVersion: string;
  /** Export and deletion controls (FEATURE_PRIVACY_V1); null shows them as coming soon. */
  privacy: { latestExport: DataRequestResponse | null; resumeDelete: boolean } | null;
}) {
  const ids = useId();
  const [status, setStatus] = useState<Status>(null);
  const [savedName, setSavedName] = useState(me.displayName ?? '');
  const [name, setName] = useState(me.displayName ?? '');
  const [timezone, setTimezone] = useState(me.timezone);
  const [prefs, setPrefs] = useState<PreferencesResponse>(me.preferences);
  const [units, setUnits] = useState<UnitSystem | null>(me.profile?.unitSystem ?? null);
  const [consents, setConsents] = useState(() => consentState(initialConsents));

  async function save<T>(apply: () => void, undo: () => void, call: () => Promise<T>) {
    apply();
    setStatus(null);
    try {
      await call();
      setStatus({ kind: 'saved', text: 'Saved' });
    } catch (err) {
      undo();
      setStatus({ kind: 'error', text: errorText(err) });
    }
  }

  function saveName(event: React.FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === savedName) return;
    const before = savedName;
    void save(
      () => setSavedName(next),
      () => {
        setSavedName(before);
        setName(before);
      },
      () => browserApi.updateProfile({ displayName: next }),
    );
  }

  function changeTimezone(next: string) {
    const before = timezone;
    void save(
      () => setTimezone(next),
      () => setTimezone(before),
      () => browserApi.updateProfile({ timezone: next }),
    );
  }

  function changePrefs(update: Partial<PreferencesResponse>) {
    const before = prefs;
    const next = { ...prefs, ...update };
    void save(
      () => {
        setPrefs(next);
        applyTheme(next.theme);
      },
      () => {
        setPrefs(before);
        applyTheme(before.theme);
      },
      () => browserApi.updatePreferences(update),
    );
  }

  function changeUnits(next: UnitSystem) {
    const before = units;
    void save(
      () => setUnits(next),
      () => setUnits(before),
      () => browserApi.updateProfile({ unitSystem: next }),
    );
  }

  function toggleConsent(purpose: ConsentPurpose) {
    const granted = !consents[purpose];
    void save(
      () => setConsents((c) => ({ ...c, [purpose]: granted })),
      () => setConsents((c) => ({ ...c, [purpose]: !granted })),
      () => browserApi.recordConsent({ purpose, granted, policyVersion, channel: 'web' }),
    );
  }

  const profile = me.profile;

  return (
    <>
      <section className="settings-summary card" aria-label="Account">
        <span className="avatar large" aria-hidden="true">
          {((savedName || me.email)[0] ?? '?').toUpperCase()}
        </span>
        <span>
          <strong data-testid="settings-name">{savedName || 'Add your name'}</strong>
          <span className="settings-muted">{me.email} · Free beta</span>
        </span>
      </section>

      <p
        className={`settings-status ${status?.kind ?? ''}`}
        role={status?.kind === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {status?.text}
      </p>

      <section className="settings-group" aria-labelledby={`${ids}-account`}>
        <h2 id={`${ids}-account`}>Account</h2>
        <div className="settings-list">
          <form className="settings-row" onSubmit={saveName}>
            <label htmlFor={`${ids}-name`}>Display name</label>
            <span className="settings-control">
              <input
                id={`${ids}-name`}
                className="input"
                value={name}
                maxLength={60}
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="submit"
                className="button small"
                disabled={!name.trim() || name.trim() === savedName}
              >
                Save
              </button>
            </span>
          </form>
          <div className="settings-row">
            <span>Email</span>
            <span className="settings-muted">{me.email}</span>
          </div>
          <div className="settings-row">
            <label htmlFor={`${ids}-tz`}>Time zone</label>
            <select
              id={`${ids}-tz`}
              className="input"
              value={timezone}
              onChange={(e) => changeTimezone(e.target.value)}
            >
              {timeZoneOptions(timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="settings-group" aria-labelledby={`${ids}-app`}>
        <h2 id={`${ids}-app`}>App</h2>
        <div className="settings-list">
          <fieldset className="settings-row">
            <legend>Theme</legend>
            <span className="segmented">
              {THEME_OPTIONS.map((o) => (
                <label key={o.value}>
                  <input
                    type="radio"
                    name="theme"
                    value={o.value}
                    checked={prefs.theme === o.value}
                    onChange={() => changePrefs({ theme: o.value })}
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </span>
          </fieldset>
          <fieldset className="settings-row">
            <legend>Coach tone</legend>
            <span className="segmented">
              {COACH_TONE_OPTIONS.map((o) => (
                <label key={o.value}>
                  <input
                    type="radio"
                    name="coachTone"
                    value={o.value}
                    checked={prefs.coachTone === o.value}
                    onChange={() => changePrefs({ coachTone: o.value })}
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </span>
          </fieldset>
          <div className="settings-row">
            <label htmlFor={`${ids}-units`}>Units</label>
            {units ? (
              <select
                id={`${ids}-units`}
                className="input"
                value={units}
                onChange={(e) => changeUnits(e.target.value as UnitSystem)}
              >
                <option value="METRIC">kg, cm</option>
                <option value="IMPERIAL">lb, ft/in</option>
              </select>
            ) : (
              <span id={`${ids}-units`} className="settings-muted">
                kg, cm · change after setup
              </span>
            )}
          </div>
        </div>
      </section>

      {profile && (
        <section className="settings-group" aria-labelledby={`${ids}-plan`}>
          <h2 id={`${ids}-plan`}>Plan</h2>
          <div className="settings-list">
            <div className="settings-row">
              <span>Equipment</span>
              <span className="settings-muted">
                {profile.equipment.map(readable).join(', ') || 'None'}
              </span>
            </div>
            <div className="settings-row">
              <span>Diet and allergies</span>
              <span className="settings-muted">
                {[DIET_LABELS[profile.dietType], ...profile.allergens.map(readable)].join(', ')}
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="settings-group" aria-labelledby={`${ids}-privacy`}>
        <h2 id={`${ids}-privacy`}>Privacy</h2>
        <div className="settings-list">
          <div className="settings-row">
            <span>
              Core service
              <span className="settings-hint">Needed to run your account. Required.</span>
            </span>
            <span className="settings-muted">On</span>
          </div>
          {SETTINGS_CONSENTS.map((c) => (
            <div className="settings-row" key={c.purpose}>
              <span id={`${ids}-${c.purpose}`}>
                {c.label}
                <span className="settings-hint">{c.description}</span>
              </span>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={consents[c.purpose]}
                aria-labelledby={`${ids}-${c.purpose}`}
                onClick={() => toggleConsent(c.purpose)}
              />
            </div>
          ))}
          {privacy ? (
            <>
              <ExportData initial={privacy.latestExport} />
              <DeleteAccount resume={privacy.resumeDelete} />
            </>
          ) : (
            <>
              <div className="settings-row">
                <span>Export my data</span>
                <span className="settings-muted">Coming soon</span>
              </div>
              <div className="settings-row">
                <span className="danger-text">Delete account</span>
                <span className="settings-muted">Coming soon</span>
              </div>
            </>
          )}
        </div>
        <p className="fine-print">Privacy policy version {policyVersion}</p>
      </section>
    </>
  );
}
