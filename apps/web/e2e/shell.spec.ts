import { expect, test, type Page } from '@playwright/test';

/** A fresh user per run, so the profile-service row never collides with an earlier run. */
const email = (label: string) =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function signIn(page: Page, address: string, staff = false) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth\/sign-in\?returnTo=%2F$/);
  await page.getByRole('link', { name: 'More sign-in options' }).click();
  // dev-auth's local sign-in form stands in for Cognito managed login.
  await page.getByLabel('Email').fill(address);
  if (staff) await page.getByLabel('Staff (admin console)').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('signs in through dev-auth and lands on Today with the email from /v1/me', async ({
  page,
  context,
}) => {
  const address = email('priya');
  await signIn(page, address);
  await expect(page.getByTestId('me-email')).toHaveText(address);
  for (const tab of ['Today', 'Train', 'Eat', 'Coach', 'Progress']) {
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: tab }),
    ).toBeVisible();
  }

  const session = (await context.cookies()).find((c) => c.name === '__Host-session');
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  const visibleToScript = await page.evaluate(() => ({
    cookies: document.cookie,
    storage: Object.keys(localStorage).length + Object.keys(sessionStorage).length,
  }));
  expect(visibleToScript).toEqual({ cookies: '', storage: 0 });

  const me = await page.request.get('/api/v1/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).email).toBe(address);

  const forged = await page.request.patch('/api/v1/me', {
    headers: { origin: 'https://evil.example' },
    data: {},
  });
  expect(forged.status()).toBe(403);
});

test('keeps non-staff out of /admin', async ({ page }) => {
  await signIn(page, email('member'));
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(403);
  await expect(page.getByRole('heading', { name: /don.t have access/ })).toBeVisible();
});

test('shows the admin console to staff', async ({ page }) => {
  await signIn(page, email('staff'), true);
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toContainText('Audit log');
});

test('sign out clears the session', async ({ page, context }) => {
  await signIn(page, email('leaver'));
  // On phones sign out lives in Settings (W13); it is there on every screen size.
  await page.goto('/settings');
  await page.getByRole('main').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  const names = (await context.cookies()).map((c) => c.name);
  expect(names).not.toContain('__Host-session');
  expect(names).not.toContain('__Host-refresh');
});
