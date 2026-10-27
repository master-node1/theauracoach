import { loadFlags, type FlagValues, type MeResponse, type Theme } from '@aura/api-client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useApi } from './api';
import { appConfig } from './config';

interface MeContextValue {
  me: MeResponse | null;
  failed: boolean;
  /** The saved theme, applied to every screen through usePalette. */
  theme: Theme;
  setTheme(theme: Theme): void;
  /** The user's evaluated feature flags (env defaults until they load or if they fail). */
  flags: FlagValues;
  reload(): Promise<void>;
}

const MeContext = createContext<MeContextValue | null>(null);

/** Loads `/v1/me` once after sign-in and shares it, so every screen sees the same preferences. */
export function MeProvider({
  enabled,
  children,
}: {
  /** True while signed in; signing out drops the user and returns to the device theme. */
  enabled: boolean;
  children: React.ReactNode;
}) {
  const api = useApi();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [flags, setFlags] = useState<FlagValues>(appConfig.flagDefaults);

  const reload = useCallback(async () => {
    void loadFlags(api, appConfig.flagDefaults).then(setFlags);
    try {
      const next = await api.me();
      setMe(next);
      setTheme(next.preferences.theme);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    if (enabled) {
      void reload();
    } else {
      setMe(null);
      setTheme('system');
      setFlags(appConfig.flagDefaults);
    }
  }, [enabled, reload]);

  const value = useMemo(
    () => ({ me, failed, theme, setTheme, flags, reload }),
    [me, failed, theme, flags, reload],
  );
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

const SIGNED_OUT: MeContextValue = {
  me: null,
  failed: false,
  theme: 'system',
  setTheme: () => undefined,
  flags: appConfig.flagDefaults,
  reload: async () => undefined,
};

/** Outside MeProvider (sign-in screens) there is no user and the device theme applies. */
export function useMe(): MeContextValue {
  return useContext(MeContext) ?? SIGNED_OUT;
}

/** Feature flags for the signed-in user, from `GET /v1/me/flags`. */
export function useFlags(): FlagValues {
  return useMe().flags;
}
