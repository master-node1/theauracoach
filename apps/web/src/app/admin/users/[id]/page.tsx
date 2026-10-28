import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FieldList } from '@/components/admin/FieldList';
import { adminApi, settle, SUPPORT_SECTION_SERVICES } from '@/lib/admin-api';
import { currentSession } from '@/lib/server-session';

export const metadata: Metadata = { title: 'Support view' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The masked support view (admin LLD §6), assembled here from each service's admin read endpoint.
 * profile-service records the view in the audit log; a service that does not answer shows as
 * unavailable without hiding the rest.
 */
export default async function SupportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const api = adminApi((await currentSession())!);
  const account = await settle(api.userAccount(id));
  if (!account.ok && account.status === 404) notFound();
  const sections = await Promise.all(
    SUPPORT_SECTION_SERVICES.map(async (service) => ({
      service,
      result: await settle(api.userSection(service, id)),
    })),
  );

  return (
    <>
      <p>
        <Link href="/admin/users">Users</Link>
      </p>
      <h1 className="page-title">Support view</h1>
      <p className="hint">
        User <code>{id}</code>
        {account.ok ? ` · ${account.value.emailMasked}` : ''} · masked; this view is audited.
      </p>
      <div className="section-grid">
        <section className="card" aria-labelledby="sec-account">
          <h2 id="sec-account">Account</h2>
          {account.ok ? (
            <FieldList fields={account.value.fields} />
          ) : (
            <p>Account details are unavailable right now.</p>
          )}
        </section>
        {sections.map(({ service, result }) => (
          <section key={service} className="card" aria-labelledby={`sec-${service}`}>
            <h2 id={`sec-${service}`}>{result.ok ? result.value.title : service}</h2>
            {result.ok ? <FieldList fields={result.value.fields} /> : <p>Unavailable right now.</p>}
          </section>
        ))}
      </div>
    </>
  );
}
