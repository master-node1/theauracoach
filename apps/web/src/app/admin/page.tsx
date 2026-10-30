import Link from 'next/link';
import type { UsageMetric } from '@aura/contracts';
import { AuditTable } from '@/components/admin/AuditTable';
import { adminApi, settle } from '@/lib/admin-api';
import { hasPermission } from '@/lib/admin-access';
import { formatNumber } from '@/lib/format';
import { currentSession } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** Headline numbers (W14): which service reports each, and under which key. */
const KPIS = [
  { service: 'profile', key: 'dau', label: 'Daily active users' },
  { service: 'profile', key: 'signups_7d', label: 'Sign-ups, 7 days' },
  { service: 'workout', key: 'sessions_24h', label: 'Sessions logged, 24 h' },
  { service: 'nutrition', key: 'meals_24h', label: 'Meals logged, 24 h' },
] as const;

export default async function AdminDashboardPage() {
  const session = (await currentSession())!;
  const api = adminApi(session);
  const canUsage = hasPermission(session.groups, 'usage:read');
  const canAudit = hasPermission(session.groups, 'audit:read');

  const [profile, workout, nutrition, recent] = await Promise.all([
    canUsage ? settle(api.usage('profile')) : null,
    canUsage ? settle(api.usage('workout')) : null,
    canUsage ? settle(api.usage('nutrition')) : null,
    canAudit ? settle(api.audit({ limit: '8' })) : null,
  ]);
  const metrics: Record<string, UsageMetric[] | null> = {
    profile: profile?.ok ? profile.value.metrics : null,
    workout: workout?.ok ? workout.value.metrics : null,
    nutrition: nutrition?.ok ? nutrition.value.metrics : null,
  };

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      {canUsage ? (
        <section aria-label="Key numbers" className="kpi-grid">
          {KPIS.map((k) => {
            const value = metrics[k.service]?.find((m) => m.key === k.key)?.value;
            return (
              <div key={k.key} className="stat-tile">
                <span className="stat-label">{k.label}</span>
                <span className="stat-value">
                  {value === undefined ? '—' : formatNumber(value)}
                </span>
                {value === undefined && <span className="stat-note">Unavailable</span>}
              </div>
            );
          })}
        </section>
      ) : null}
      {canUsage ? (
        <p>
          <Link href="/admin/usage">Usage and health</Link> has every counter, queue health and
          error rates.
        </p>
      ) : null}
      {recent ? (
        <section className="card" aria-labelledby="recent-changes">
          <div className="card-header">
            <h2 id="recent-changes">Recent changes</h2>
            <Link href="/admin/audit">Audit log</Link>
          </div>
          {recent.ok ? (
            <AuditTable entries={recent.value.entries} />
          ) : (
            <p>The audit log is unavailable right now.</p>
          )}
        </section>
      ) : null}
      {!canUsage && !recent ? (
        <section className="card">
          <h2>Welcome</h2>
          <p>Use the sections on the left. Each one shows what your roles allow.</p>
        </section>
      ) : null}
    </>
  );
}
