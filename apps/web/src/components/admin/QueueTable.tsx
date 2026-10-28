import type { OpsService, QueueHealth } from '@aura/contracts';
import type { Settled } from '@/lib/admin-api';
import { formatNumber } from '@/lib/format';
import { TableScroll } from './TableScroll';

/** Outbox and dead-letter health per service; anything waiting over a minute is flagged. */
export function QueueTable({
  rows,
}: {
  rows: { service: OpsService; result: Settled<QueueHealth> }[];
}) {
  return (
    <TableScroll label="Queues">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Outbox waiting</th>
            <th scope="col">Oldest waiting</th>
            <th scope="col">Dead letters</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ service, result }) => (
            <tr key={service}>
              <th scope="row">{service}</th>
              {result.ok ? (
                <>
                  <td>{formatNumber(result.value.outboxPending)}</td>
                  <td className={result.value.outboxOldestAgeSeconds > 60 ? 'warn' : undefined}>
                    {result.value.outboxPending ? `${result.value.outboxOldestAgeSeconds} s` : '—'}
                  </td>
                  <td className={result.value.dlqLength > 0 ? 'warn' : undefined}>
                    {formatNumber(result.value.dlqLength)}
                  </td>
                </>
              ) : (
                <td colSpan={3}>Unavailable</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
