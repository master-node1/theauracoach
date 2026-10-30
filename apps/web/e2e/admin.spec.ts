import { expect, test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Admin console smoke (TAC-32): an owner signed in with MFA uses every core section. */

const email = (label: string) =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function signIn(page: Page, address: string, staff: boolean) {
  await page.goto('/');
  await page.getByRole('link', { name: 'More sign-in options' }).click();
  await page.getByLabel('Email').fill(address);
  if (staff) await page.getByLabel('Staff (admin console)').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  if (staff) {
    await page.getByLabel('Authenticator code').fill('123456');
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page).toHaveURL(/\/$/);
}

/** Signs a member in once in a separate browser context, so profile-service has their account. */
async function provisionMember(browser: Browser, address: string) {
  const context = await browser.newContext();
  await signIn(await context.newPage(), address, false);
  await context.close();
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).include('main').analyze();
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact!));
  expect(
    serious.map(
      (v) =>
        `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.failureSummary).join(' / ')}`,
    ),
  ).toEqual([]);
}

const adminNav = (page: Page) => page.getByRole('navigation', { name: 'Admin' });

test('owner uses the dashboard, roles, support view, audit log, usage and operations', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const member = email('member');
  // Unique per run: the audit log keeps every earlier run's entries.
  const revokeReason = `Left the support rota ${Date.now()}`;
  await provisionMember(browser, member);
  await signIn(page, email('owner'), true);

  // Dashboard
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByText('Daily active users')).toBeVisible();
  await expectAccessible(page);

  // Roles: grant support to the member, then revoke it, each with a reason.
  await adminNav(page).getByRole('link', { name: 'Roles' }).click();
  await expect(page.getByRole('heading', { name: 'Roles', level: 1 })).toBeVisible();
  const grant = page.getByRole('form', { name: 'Grant a role' });
  await grant.getByLabel('Email').fill(member);
  await grant.getByLabel('Role').selectOption('support');
  await grant.getByLabel('Reason').fill('Joins the support rota');
  await grant.getByRole('button', { name: 'Grant role' }).click();
  await expect(grant.getByRole('status')).toContainText('Granted support');
  const row = page.getByRole('row').filter({ hasText: member });
  await expect(row).toBeVisible();
  await expectAccessible(page);
  await row.getByRole('button', { name: 'Revoke' }).click();
  const dialog = page.getByRole('dialog', { name: 'Revoke support' });
  await dialog.getByLabel(/Reason/).fill(revokeReason);
  await dialog.getByRole('button', { name: 'Revoke role' }).click();
  await expect(row).toHaveCount(0);

  // Support view: find the member by email, open the masked view.
  await adminNav(page).getByRole('link', { name: 'Users' }).click();
  await page.getByLabel('Email or user id').fill(member);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByRole('cell', { name: /^me\*\*\*@e\*\*\*\.com$/ })).toBeVisible();
  await page.getByRole('link', { name: 'Open support view' }).click();
  await expect(page.getByRole('heading', { name: 'Support view', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(member);
  await expectAccessible(page);

  // Audit log: the revoke (with its reason) and the support view arrive through the event bus.
  await adminNav(page).getByRole('link', { name: 'Audit log' }).click();
  await page.getByLabel('Action').fill('role.revoke');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('cell', { name: revokeReason })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });
  await expectAccessible(page);
  const csv = await page.request.get(
    `/api/v1/admin/audit/export.csv?action=${encodeURIComponent('role.revoke')}`,
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain(revokeReason);

  // Usage and health, operations.
  await adminNav(page).getByRole('link', { name: 'Usage and cost' }).click();
  await expect(page.getByRole('heading', { name: 'Queues' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'audit' })).toBeVisible();
  await expectAccessible(page);
  await adminNav(page).getByRole('link', { name: 'Operations' }).click();
  await expect(page.getByRole('heading', { name: /^coach/ })).toBeVisible();
  await expectAccessible(page);
});

test('a section and its API are closed without the permission', async ({ page }) => {
  await signIn(page, email('member-no-admin'), false);
  expect((await page.goto('/admin/audit'))?.status()).toBe(403);
  const api = await page.request.get('/api/v1/admin/audit');
  expect(api.status()).toBe(403);
  const ops = await page.request.get('/api/v1/admin/ops/coach/dlq');
  expect(ops.status()).toBe(403);
});
