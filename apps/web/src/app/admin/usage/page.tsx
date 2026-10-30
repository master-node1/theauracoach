import type { Metadata } from 'next';
import { QueueTable } from '@/components/admin/QueueTable';
import { adminApi, OPS_SERVICES, settle } from '@/lib/admin-api';
import { config } from '@/lib/config';
import { formatNumber } from '@/lib/format';
import { currentSession } from '@/lib/server-session';

export const metadata: Metadata = { title: 'Usage and health' };
export const dynamic = 'force-dynamic';

/**
 * Usage and health (admin LLD §4): each service's counters, error rate and latency from Grafana
 * (when ADMIN_GRAFANA_PANELS is set) and queue health. AI cost arrives with TAC-34.
 */
export default async function UsagePage() {
  const api = adminApi((await currentSession())!);
  const [usage, queues] = await Promise.all([
    Promise.all(
      OPS_SERVICES.map(async (service) => ({ service, result: await settle(api.usage(service)) })),
    ),
    api.allQueues(),
  ]);
  const panels = config().grafanaPanels;
  const reporting = usage.filter((u) => !u.result.ok || u.result.value.metrics.length > 0);

  return (
    <>
      <h1 className="page-title">Usage and health</h1>
      <section aria-labelledby="usage-heading" className="card">
        <h2 id="usage-heading">Usage</h2>
        <div className="kpi-grid">
          {reporting.flatMap(({ service, result }) =>
            result.ok
              ? result.value.metrics.map((m) => (
                  <div key={`${service}:${m.key}`} className="stat-tile">
                    <span className="stat-label">{m.label}</span>
                    <span className="stat-value">{formatNumber(m.value)}</span>
                  </div>
                ))
              : [
                  <div key={service} className="stat-tile">
                    <span className="stat-label">{service}</span>
                    <span className="stat-value">—</span>
                    <span className="stat-note">Unavailable</span>
                  </div>,
                ],
          )}
        </div>
      </section>
      {panels.length > 0 ? (
        <section aria-labelledby="errors-heading" className="card">
          <h2 id="errors-heading">Errors and latency</h2>
          <div className="panel-grid">
            {panels.map((p) => (
              <iframe
                key={p.url}
                title={p.title}
                src={p.url}
                className="grafana-panel"
                loading="lazy"
              />
            ))}
          </div>
        </section>
      ) : null}
      <section aria-labelledby="queues-heading" className="card">
        <h2 id="queues-heading">Queues</h2>
        <QueueTable rows={queues} />
      </section>
    </>
  );
}
