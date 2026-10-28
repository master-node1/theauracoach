import type { Metadata } from 'next';
import Link from 'next/link';
import { GRANTABLE_ROLES, type GrantableRole } from '@aura/contracts';
import { GrantRoleForm, RevokeRoleButton } from '@/components/admin/RoleActions';
import { adminApi, settle } from '@/lib/admin-api';
import { formatTime } from '@/lib/format';
import { currentSession } from '@/lib/server-session';
import { TableScroll } from '@/components/admin/TableScroll';

export const metadata: Metadata = { title: 'Roles' };
export const dynamic = 'force-dynamic';

const isRole = (v: string | undefined): v is GrantableRole =>
  !!v && (GRANTABLE_ROLES as readonly string[]).includes(v);

/** Staff roles (TAC-9 API): grants by role, grant and revoke with a reason. */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  const filter = isRole(role) ? role : null;
  const result = await settle(adminApi((await currentSession())!).roles());

  if (!result.ok) {
    return (
      <>
        <h1 className="page-title">Roles</h1>
        <p role="status">Roles are unavailable right now.</p>
      </>
    );
  }
  const { roles, grants } = result.value;
  const shown = filter ? grants.filter((g) => g.role === filter) : grants;

  return (
    <>
      <h1 className="page-title">Roles</h1>
      <section className="card" aria-labelledby="grant-heading">
        <h2 id="grant-heading">Grant a role</h2>
        <p className="hint">
          The person must have signed in once. Roles take effect at their next sign-in or token
          refresh.
        </p>
        <GrantRoleForm roles={[...GRANTABLE_ROLES]} />
      </section>
      <section className="card" aria-labelledby="grants-heading">
        <div className="card-header">
          <h2 id="grants-heading">Current grants</h2>
          <nav aria-label="Filter by role" className="chip-row">
            <Link className="chip" href="/admin/roles" aria-current={filter ? undefined : 'page'}>
              All ({grants.length})
            </Link>
            {roles.map((r) => (
              <Link
                key={r.id}
                className="chip"
                href={`/admin/roles?role=${r.id}`}
                aria-current={filter === r.id ? 'page' : undefined}
              >
                {r.id} ({grants.filter((g) => g.role === r.id).length})
              </Link>
            ))}
          </nav>
        </div>
        {shown.length === 0 ? (
          <p>No grants.</p>
        ) : (
          <TableScroll label="Role grants">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Granted</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={`${g.userId}:${g.role}`}>
                    <td>{g.email}</td>
                    <td>{g.role}</td>
                    <td>{formatTime(g.grantedAt)}</td>
                    <td>
                      <RevokeRoleButton userId={g.userId} email={g.email} role={g.role} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
      <section className="card" aria-labelledby="roles-heading">
        <h2 id="roles-heading">What each role can do</h2>
        <dl className="field-list">
          {roles.map((r) => (
            <div key={r.id}>
              <dt>{r.id}</dt>
              <dd>
                {r.description}
                <span className="hint block">{r.permissions.join(', ')}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
