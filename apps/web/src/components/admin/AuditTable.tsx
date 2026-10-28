import Link from 'next/link';
import type { AuditEntry } from '@aura/contracts';
import { formatTime, readableAction } from '@/lib/format';
import { TableScroll } from './TableScroll';

/** Audit entries as a table; each row opens its detail with the before/after diff. */
export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <p>No entries match.</p>;
  return (
    <TableScroll label="Audit entries">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">Action</th>
            <th scope="col">Item</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>
                <Link href={`/admin/audit/${e.id}`}>{formatTime(e.createdAt)}</Link>
              </td>
              <td>
                {e.actorId ? (
                  <>
                    <code>{e.actorId.slice(0, 8)}</code> {e.actorRole}
                  </>
                ) : (
                  'System'
                )}
              </td>
              <td>{readableAction(e.action)}</td>
              <td>
                {e.entityType}: <code>{e.entityId}</code>
              </td>
              <td>{e.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
