import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminApi, settle } from '@/lib/admin-api';
import { formatTime, readableAction } from '@/lib/format';
import { currentSession } from '@/lib/server-session';
import { TableScroll } from '@/components/admin/TableScroll';

export const metadata: Metadata = { title: 'Audit entry' };
export const dynamic = 'force-dynamic';

const show = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));

/** One entry with a field-by-field before/after diff. Sensitive fields arrive already removed. */
export default async function AuditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,19}$/.test(id)) notFound();
  const result = await settle(adminApi((await currentSession())!).auditEntry(id));
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="status">The audit log is unavailable right now.</p>;
  }
  const e = result.value;
  const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])].sort();

  return (
    <>
      <p>
        <Link href="/admin/audit">Audit log</Link>
      </p>
      <h1 className="page-title">{readableAction(e.action)}</h1>
      <section className="card">
        <dl className="field-list">
          <div>
            <dt>When</dt>
            <dd>{formatTime(e.createdAt)}</dd>
          </div>
          <div>
            <dt>Actor</dt>
            <dd>
              {e.actorId ? <code>{e.actorId}</code> : 'System'} {e.actorRole ?? ''}
            </dd>
          </div>
          <div>
            <dt>Item</dt>
            <dd>
              {e.entityType}: <code>{e.entityId}</code>
            </dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>{e.reason ?? '—'}</dd>
          </div>
          <div>
            <dt>Request id</dt>
            <dd>{e.requestId ? <code>{e.requestId}</code> : '—'}</dd>
          </div>
        </dl>
      </section>
      <section className="card" aria-labelledby="diff">
        <h2 id="diff">Changes</h2>
        {keys.length === 0 ? (
          <p>No before or after values recorded.</p>
        ) : (
          <TableScroll label="Changes">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const before = e.before?.[k];
                  const after = e.after?.[k];
                  const changed = show(before) !== show(after);
                  return (
                    <tr key={k} className={changed ? 'changed' : undefined}>
                      <th scope="row">
                        {k}
                        {changed ? <span className="visually-hidden"> (changed)</span> : null}
                      </th>
                      <td>
                        <code>{show(before)}</code>
                      </td>
                      <td>
                        <code>{show(after)}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
    </>
  );
}
