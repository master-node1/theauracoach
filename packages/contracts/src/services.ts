/** Every deployable NestJS service. The nginx api-gateway is not listed: it has no identity of its own. */
export const SERVICE_NAMES = [
  'profile-service',
  'workout-service',
  'nutrition-service',
  'progress-service',
  'coach-service',
  'notification-service',
  'audit-service',
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

/** Local development ports. Kubernetes uses 3000 for every service. */
export const LOCAL_PORTS: Record<ServiceName, number> = {
  'profile-service': 3001,
  'workout-service': 3002,
  'nutrition-service': 3003,
  'progress-service': 3004,
  'coach-service': 3005,
  'notification-service': 3006,
  'audit-service': 3007,
};

export function isServiceName(value: unknown): value is ServiceName {
  return typeof value === 'string' && (SERVICE_NAMES as readonly string[]).includes(value);
}
