export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness for the Kubernetes probes (infra/helm/values/web.yaml). Answers without
 * reading config or calling the gateway, so a gateway outage does not restart every web pod.
 */
export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
