/**
 * Typed client for the AuraCoach API (docs/api/openapi.yaml). It only knows the endpoints the
 * apps use so far; each slice adds its own. Works anywhere `fetch` exists (Node, browsers,
 * React Native).
 */

import type { Role } from '@aura/contracts';

/** `Me` in docs/api/openapi.yaml, returned by profile-service. */
export interface MeResponse {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  locale: string;
  onboardingComplete: boolean;
  status: 'ACTIVE' | 'PENDING_DELETION';
  roles: Role[];
}

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
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, '');

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

  return {
    request,
    me: () => request<MeResponse>('/v1/me'),
  };
}
