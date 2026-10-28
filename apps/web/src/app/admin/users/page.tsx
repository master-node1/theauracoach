import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminApi, settle } from '@/lib/admin-api';
import { formatTime } from '@/lib/format';
import { currentSession } from '@/lib/server-session';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Support lookup: a user id opens the support view; an email finds the account first. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? '').trim();
  if (UUID.test(q)) redirect(`/admin/users/${q.toLowerCase()}`);
  const session = (await currentSession())!;
  const isEmail = q.includes('@');
  const result = isEmail ? await settle(adminApi(session).lookupUser(q)) : null;

  return (
    <>
      <h1 className="page-title">Users</h1>
      <section className="card">
        <form className="admin-form inline" role="search" action="/admin/users">
          <div className="field grow">
            <label htmlFor="user-q">Email or user id</label>
            <input id="user-q" name="q" className="input" defaultValue={q} required />
          </div>
          <button type="submit" className="button small primary">
            Find
          </button>
        </form>
        <p className="hint">
          The support view is masked and every view is recorded in the audit log.
        </p>
      </section>
      {q && !isEmail ? <p role="status">Enter a full email address or a user id.</p> : null}
      {result && !result.ok ? (
        <p role="status">
          {result.status === 404 ? 'No account uses that email.' : 'The lookup failed. Try again.'}
        </p>
      ) : null}
      {result?.ok ? (
        <section className="card" aria-label="Result">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">
                    <span className="visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{result.value.emailMasked}</td>
                  <td>{result.value.status}</td>
                  <td>{formatTime(result.value.createdAt)}</td>
                  <td>
                    <Link href={`/admin/users/${result.value.userId}`}>Open support view</Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
