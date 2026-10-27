/**
 * Typed client for the AuraCoach API (docs/api/openapi.yaml). It only knows the endpoints the
 * apps use so far; each slice adds its own. Works anywhere `fetch` exists (Node, browsers,
 * React Native).
 */

import { envFlagDefaults, type FlagValues, type FlagsResponse } from '@aura/contracts';
import type {
  ConsentInput,
  ConsentResponse,
  MeResponse as MeContract,
  PreferencesResponse,
  PreferencesUpdate,
  ProfileUpdate,
  ProfileUpdateResponse,
  Role,
} from '@aura/contracts';

export type {
  CoachTone,
  ConsentInput,
  ConsentPurpose,
  ConsentResponse,
  PreferencesResponse,
  PreferencesUpdate,
  ProfileResponse,
  ProfileUpdate,
  ProfileUpdateResponse,
  FlagKey,
  FlagValues,
  FlagsResponse,
  Theme,
  UnitSystem,
} from '@aura/contracts';
export { catalogueDefaults, envFlagDefaults, FEATURE_FLAGS } from '@aura/contracts';

/** `Me` in docs/api/openapi.yaml, returned by profile-service. */
export type MeResponse = Omit<MeContract, 'roles'> & { roles: Role[] };

/** The privacy policy version the apps show and record consents against. */
export const CURRENT_POLICY_VERSION = '2026-10';

/** RFC 9457 problem document, as every service returns on errors. */
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.title ?? `API request failed with status ${status}`);
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.problem?.code;
  }
}

export interface ApiClientOptions {
  /** Gateway origin, e.g. http://localhost:8080. */
  baseUrl: string;
  /** Bearer token for the call; return null to call without one. */
  getAccessToken?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
}

export interface ApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  me(): Promise<MeResponse>;
  updateProfile(update: ProfileUpdate): Promise<ProfileUpdateResponse>;
  preferences(): Promise<PreferencesResponse>;
  updatePreferences(update: PreferencesUpdate): Promise<PreferencesResponse>;
  consents(): Promise<ConsentResponse[]>;
  recordConsent(input: ConsentInput): Promise<ConsentResponse>;
  /** The caller's evaluated feature flags. */
  flags(): Promise<FlagsResponse>;
}

/** Drops trailing slashes without a regex (a `/\/+$/` scan is quadratic on long slash runs). */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? fetch;
  const base = trimTrailingSlashes(options.baseUrl);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    const token = await options.getAccessToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await doFetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      let problem: Problem | null = null;
      try {
        problem = (await res.json()) as Problem;
      } catch {
        problem = null;
      }
      throw new ApiError(res.status, problem);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const send = <T>(method: 'PATCH' | 'POST', path: string, body: unknown) =>
    request<T>(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    request,
    me: () => request<MeResponse>('/v1/me'),
    updateProfile: (update) => send('PATCH', '/v1/me/profile', update),
    preferences: () => request<PreferencesResponse>('/v1/me/preferences'),
    updatePreferences: (update) => send('PATCH', '/v1/me/preferences', update),
    consents: () => request<ConsentResponse[]>('/v1/me/consents'),
    recordConsent: (input) => send('POST', '/v1/me/consents', input),
    flags: () => request<FlagsResponse>('/v1/me/flags'),
  };
}

/**
 * The caller's flags from `GET /v1/me/flags`, on top of `fallback` (the app's env defaults), so a
 * flag the API does not know yet, or a failed call, falls back instead of breaking the screen.
 */
export async function loadFlags(
  api: Pick<ApiClient, 'flags'>,
  fallback: FlagValues = envFlagDefaults({}),
): Promise<FlagValues> {
  try {
    const { flags } = await api.flags();
    return { ...fallback, ...flags };
  } catch {
    return fallback;
  }
}
export * from './settings';
