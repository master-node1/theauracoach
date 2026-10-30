import type { Metadata } from 'next';
import Link from 'next/link';
import { AuditTable } from '@/components/admin/AuditTable';
import { adminApi, settle } from '@/lib/admin-api';
import { currentSession } from '@/lib/server-session';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

const FILTERS = ['entityType', 'entityId', 'actorId', 'action'] as const;
type Search = Partial<
  Record<(typeof FILTERS)[number] | 'from' | 'to' | 'order' | 'cursor', string>
>;

/** `2026-10-27` from a date input → the start or end of that day in India time, as ISO. */
function dayBound(day: string | undefined, end: boolean): string | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return `${day}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`;
}

/** The audit viewer (admin LLD §5): filter, newest or oldest first, cursor pages, CSV export. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const order = search.order === 'asc' ? 'asc' : 'desc';
  const filters: Record<string, string | undefined> = {
    ...Object.fromEntries(FILTERS.map((f) => [f, search[f]?.trim() || undefined])),
    from: dayBound(search.from, false),
    to: dayBound(search.to, true),
  };
  const page = await settle(
    adminApi((await currentSession())!).audit({
      ...filters,
      order,
      cursor: search.cursor,
      limit: '50',
    }),
  );

  const link = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...search, ...extra })) if (v) q.set(k, v);
    return `/admin/audit?${q.toString()}`;
  };
  const exportQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) exportQuery.set(k, v);

  return (
    <>
      <h1 className="page-title">Audit log</h1>
      <section className="card">
        <form
          className="admin-form filters"
          action="/admin/audit"
          aria-label="Filter the audit log"
        >
          <div className="field">
            <label htmlFor="f-action">Action</label>
            <input
              id="f-action"
              name="action"
              className="input"
              placeholder="role or role.grant"
              defaultValue={search.action}
            />
          </div>
          <div className="field">
            <label htmlFor="f-entity-type">Item type</label>
            <input
              id="f-entity-type"
              name="entityType"
              className="input"
              placeholder="user_role"
              defaultValue={search.entityType}
            />
          </div>
          <div className="field">
            <label htmlFor="f-entity-id">Item id</label>
            <input
              id="f-entity-id"
              name="entityId"
              className="input"
              defaultValue={search.entityId}
            />
          </div>
          <div className="field">
            <label htmlFor="f-actor">Actor id</label>
            <input id="f-actor" name="actorId" className="input" defaultValue={search.actorId} />
          </div>
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input
              id="f-from"
              name="from"
              type="date"
              className="input"
              defaultValue={search.from}
            />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input id="f-to" name="to" type="date" className="input" defaultValue={search.to} />
          </div>
          <div className="field">
            <label htmlFor="f-order">Order</label>
            <select id="f-order" name="order" className="input" defaultValue={order}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
          <div className="admin-actions">
            <button type="submit" className="button small primary">
              Apply
            </button>
            <Link className="button small" href="/admin/audit">
              Clear
            </Link>
            <a
              className="button small"
              href={`/api/v1/admin/audit/export.csv?${exportQuery.toString()}`}
            >
              Export CSV
            </a>
          </div>
        </form>
      </section>
      <section className="card" aria-label="Entries">
        {page.ok ? (
          <>
            <AuditTable entries={page.value.entries} />
            <div className="admin-actions">
              {search.cursor ? (
                <Link className="button small" href={link({ cursor: undefined })}>
                  First page
                </Link>
              ) : null}
              {page.value.nextCursor ? (
                <Link className="button small" href={link({ cursor: page.value.nextCursor })}>
                  {order === 'desc' ? 'Older entries' : 'Newer entries'}
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <p role="status">
            {page.status === 422
              ? 'Check the filters: an actor id must be a full user id.'
              : 'The audit log is unavailable right now.'}
          </p>
        )}
      </section>
    </>
  );
}
