'use client';

import { useRouter } from 'next/navigation';
import type { OpsService } from '@aura/contracts';
import { browserApi } from '@/lib/browser-api';
import { ReasonDialog } from './ReasonDialog';

/** Re-publishes one dead-lettered event; the service audits it with the reason. */
export function ReplayButton({
  service,
  id,
  eventType,
}: {
  service: OpsService;
  id: string;
  eventType: string | null;
}) {
  const router = useRouter();
  return (
    <ReasonDialog
      label="Replay"
      title={`Replay ${eventType ?? 'event'}`}
      description={`Publishes the event again for ${service}. Services that already handled it skip it.`}
      confirmLabel="Replay once"
      onConfirm={async (reason) => {
        await browserApi.request(`/v1/admin/ops/${service}/dlq/${encodeURIComponent(id)}/replay`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        router.refresh();
      }}
    />
  );
}
