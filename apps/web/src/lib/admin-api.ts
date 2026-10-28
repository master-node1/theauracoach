import { ApiError } from '@aura/api-client';
import {
  adminOpsPath,
  OPS_SERVICES,
  type AdminUserAccount,
  type AdminUserLookup,
  type AdminUserSection,
  type AuditEntry,
  type AuditPage,
  type DlqList,
  type OpsService,
  type QueueHealth,
  type RoleListResponse,
  type ServiceUsage,
} from '@aura/contracts';
import { serverApi } from './server-session';
import type { Session } from './session';

/** A call that may fail on its own without failing the page (one service down, one section). */
export type Settled<T> = { ok: true; value: T } | { ok: false; status: number | null };

export async function settle<T>(call: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await call };
  } catch (err) {
    return { ok: false, status: err instanceof ApiError ? err.status : null };
  }
}

/** Services whose support-view section comes from `/v1/admin/ops/{service}/users/{id}`. */
export const SUPPORT_SECTION_SERVICES: OpsService[] = [
  'workout',
  'nutrition',
  'progress',
  'coach',
  'notification',
];

const query = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};

/** Typed admin calls for server components, with the signed-in staff member's token. */
export function adminApi(session: Session) {
  const api = serverApi(session);
  const queues = (service: OpsService) =>
    api.request<QueueHealth>(`${adminOpsPath(service)}/queues`);
  return {
    roles: () => api.request<RoleListResponse>('/v1/admin/roles'),
    lookupUser: (email: string) =>
      api.request<AdminUserLookup>(`/v1/admin/users${query({ email })}`),
    /** Audited: profile-service records every view. */
    userAccount: (id: string) =>
      api.request<AdminUserAccount>(`/v1/admin/users/${encodeURIComponent(id)}`),
    userSection: (service: OpsService, id: string) =>
      api.request<AdminUserSection>(`${adminOpsPath(service)}/users/${encodeURIComponent(id)}`),
    audit: (params: Record<string, string | undefined>) =>
      api.request<AuditPage>(`/v1/admin/audit${query(params)}`),
    auditEntry: (id: string) =>
      api.request<AuditEntry>(`/v1/admin/audit/${encodeURIComponent(id)}`),
    usage: (service: OpsService) => api.request<ServiceUsage>(`${adminOpsPath(service)}/usage`),
    queues,
    dlq: (service: OpsService) => api.request<DlqList>(`${adminOpsPath(service)}/dlq`),
    /** Every service's queue health; a service that does not answer shows as unavailable. */
    allQueues: () =>
      Promise.all(
        OPS_SERVICES.map(async (service) => ({ service, result: await settle(queues(service)) })),
      ),
  };
}

export { OPS_SERVICES };
