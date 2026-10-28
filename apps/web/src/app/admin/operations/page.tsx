import type { Metadata } from 'next';
import { ReplayButton } from '@/components/admin/ReplayButton';
import { adminApi, OPS_SERVICES, settle } from '@/lib/admin-api';
import { formatTime } from '@/lib/format';
import { currentSession } from '@/lib/server-session';

export const metadata: Metadata = { title: 'Operations' };
export const dynamic = 'force-dynamic';

/**
 * Dead-lettered events per service (platform LLD §4.2). Replaying publishes the event once more;
 * each replay is audited with its reason.
 */
export default async function OperationsPage() {
  const api = adminApi((await currentSession())!);
  const lists = await Promise.all(
    OPS_SERVICES.map(async (service) => ({ service, result: await settle(api.dlq(service)) })),
  );

  return (
    <>
      <h1 className="page-title">Operations</h1>
      <p className="hint">
        Events a service could not handle after five tries. Fix the cause first, then replay.
      </p>
      {lists.map(({ service, result }) => (
        <section key={service} className="card" aria-labelledby={`dlq-${service}`}>
          <h2 id={`dlq-${service}`}>
            {service}
            {result.ok ? ` · ${result.value.total} dead-lettered` : ''}
          </h2>
          {!result.ok ? (
            <p>Unavailable right now.</p>
          ) : result.value.entries.length === 0 ? (
            <p>Nothing dead-lettered.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Occurred</th>
                    <th scope="col">Reason</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.value.entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.eventType ?? 'Unreadable'}
                        <span className="hint block">
                          <code>{e.eventId ?? e.entryId}</code>
                        </span>
                      </td>
                      <td>{formatTime(e.occurredAt)}</td>
                      <td>{e.reason}</td>
                      <td>
                        {e.eventType ? (
                          <ReplayButton service={service} id={e.id} eventType={e.eventType} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
