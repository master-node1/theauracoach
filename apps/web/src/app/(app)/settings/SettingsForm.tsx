'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  type UnitSystem,
} from '@aura/api-client';
import { DeleteAccount } from '@/components/privacy/DeleteAccount';
import { ExportData } from '@/components/privacy/ExportData';
import { browserApi } from '@/lib/browser-api';
import { applyTheme } from '@/lib/theme';

type Status = 'saved' | 'invalidValue' | 'saveFailed' | null;

function errorStatus(err: unknown): Status {
  return err instanceof ApiError && err.status === 422 ? 'invalidValue' : 'saveFailed';
}

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
  const t = useTranslations();
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
      setStatus('saved');
    } catch (err) {
      undo();
      setStatus(errorStatus(err));
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
      <section className="settings-summary card" aria-label={t('settings.summary')}>
        <span className="avatar large" aria-hidden="true">
          {((savedName || me.email)[0] ?? '?').toUpperCase()}
        </span>
        <span>
          <strong data-testid="settings-name">{savedName || t('settings.addName')}</strong>
          <span className="settings-muted">{t('settings.plan', { email: me.email })}</span>
        </span>
      </section>

      <p
        className={`settings-status ${status === 'saved' ? 'saved' : status ? 'error' : ''}`}
        role={status && status !== 'saved' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {status && t(`common.${status}`)}
      </p>

      <section className="settings-group" aria-labelledby={`${ids}-account`}>
        <h2 id={`${ids}-account`}>{t('settings.account')}</h2>
        <div className="settings-list">
          <form className="settings-row" onSubmit={saveName}>
            <label htmlFor={`${ids}-name`}>{t('settings.displayName')}</label>
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
                {t('common.save')}
              </button>
            </span>
          </form>
          <div className="settings-row">
            <span>{t('settings.email')}</span>
            <span className="settings-muted">{me.email}</span>
          </div>
          <div className="settings-row">
            <label htmlFor={`${ids}-tz`}>{t('settings.timeZone')}</label>
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
        <h2 id={`${ids}-app`}>{t('settings.app')}</h2>
        <div className="settings-list">
          <fieldset className="settings-row">
            <legend>{t('settings.theme')}</legend>
            <span className="segmented">
              {THEME_OPTIONS.map((theme) => (
                <label key={theme}>
                  <input
                    type="radio"
                    name="theme"
                    value={theme}
                    checked={prefs.theme === theme}
                    onChange={() => changePrefs({ theme })}
                  />
                  <span>{t(`settings.themes.${theme}`)}</span>
                </label>
              ))}
            </span>
          </fieldset>
          <fieldset className="settings-row">
            <legend>{t('settings.coachTone')}</legend>
            <span className="segmented">
              {COACH_TONE_OPTIONS.map((coachTone) => (
                <label key={coachTone}>
                  <input
                    type="radio"
                    name="coachTone"
                    value={coachTone}
                    checked={prefs.coachTone === coachTone}
                    onChange={() => changePrefs({ coachTone })}
                  />
                  <span>{t(`settings.coachTones.${coachTone}`)}</span>
                </label>
              ))}
            </span>
          </fieldset>
          <div className="settings-row">
            <label htmlFor={`${ids}-units`}>{t('settings.units')}</label>
            {units ? (
              <select
                id={`${ids}-units`}
                className="input"
                value={units}
                onChange={(e) => changeUnits(e.target.value as UnitSystem)}
              >
                <option value="METRIC">{t('settings.unitSystems.METRIC')}</option>
                <option value="IMPERIAL">{t('settings.unitSystems.IMPERIAL')}</option>
              </select>
            ) : (
              <span id={`${ids}-units`} className="settings-muted">
                {t('settings.unitsAfterSetup')}
              </span>
            )}
          </div>
        </div>
      </section>

      {profile && (
        <section className="settings-group" aria-labelledby={`${ids}-plan`}>
          <h2 id={`${ids}-plan`}>{t('settings.planSection')}</h2>
          <div className="settings-list">
            <div className="settings-row">
              <span>{t('settings.equipment')}</span>
              <span className="settings-muted">
                {profile.equipment.map(readable).join(', ') || t('common.none')}
              </span>
            </div>
            <div className="settings-row">
              <span>{t('settings.dietAndAllergies')}</span>
              <span className="settings-muted">
                {[t(`settings.diets.${profile.dietType}`), ...profile.allergens.map(readable)].join(
                  ', ',
                )}
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="settings-group" aria-labelledby={`${ids}-privacy`}>
        <h2 id={`${ids}-privacy`}>{t('settings.privacy')}</h2>
        <div className="settings-list">
          <div className="settings-row">
            <span>
              {t('settings.coreService')}
              <span className="settings-hint">{t('settings.coreServiceHint')}</span>
            </span>
            <span className="settings-muted">{t('common.on')}</span>
          </div>
          {SETTINGS_CONSENTS.map((purpose) => (
            <div className="settings-row" key={purpose}>
              <span id={`${ids}-${purpose}`}>
                {t(`settings.consents.${purpose}.label`)}
                <span className="settings-hint">
                  {t(`settings.consents.${purpose}.description`)}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={consents[purpose]}
                aria-labelledby={`${ids}-${purpose}`}
                onClick={() => toggleConsent(purpose)}
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
                <span>{t('settings.exportData')}</span>
                <span className="settings-muted">{t('common.comingSoon')}</span>
              </div>
              <div className="settings-row">
                <span className="danger-text">{t('settings.deleteAccount')}</span>
                <span className="settings-muted">{t('common.comingSoon')}</span>
              </div>
            </>
          )}
        </div>
        <p className="fine-print">{t('settings.policyVersion', { version: policyVersion })}</p>
      </section>
    </>
  );
}
