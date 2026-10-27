import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** A fresh user per test, so deleting one never touches another run's account. */
const email = () => `privacy-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function openSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Continue' }).click();
  await page.getByLabel('Email').fill(email());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'Settings' }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
}

async function axeSerious(page: Page) {
  const results = await new AxeBuilder({ page }).include('main').analyze();
  return results.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact!))
    .map((v) => `${v.id}: ${v.help}`);
}

test('exports the account as a zip (TC-PRV-1)', async ({ page }) => {
  await openSettings(page);
  const row = page.getByTestId('export-row');
  await row.getByRole('button', { name: 'Export' }).click();
  // Every service writes its part, then profile-service zips them.
  const download = row.getByTestId('export-download');
  await expect(download).toBeVisible({ timeout: 60_000 });
  await expect(row.getByTestId('export-state')).toHaveText(/ready/);

  const file = await page.request.get((await download.getAttribute('href'))!);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 2).toString()).toBe('PK');
});

test('deletes the account, shows the grace period and restores it (TC-PRV-2/3)', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Delete…' }).click();
  const dialog = page.getByRole('dialog', { name: /Delete your account/ });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Delete account' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  // The sign-in a moment ago is fresh enough, so no second sign-in is needed here.
  await confirm.click();

  await expect(page.getByRole('heading', { name: 'Account scheduled for deletion' })).toBeVisible();
  await expect(page.getByTestId('pending-deletion-text')).toContainText('will be deleted on');
  expect(await axeSerious(page)).toEqual([]);
  // Other services refuse the account while it waits.
  expect((await page.request.get('/api/v1/me/notification-preferences')).status()).toBe(423);

  await page.getByRole('button', { name: 'Restore my account' }).click();
  await expect(page.getByTestId('me-email')).toBeVisible();
  await expect
    .poll(async () => (await page.request.get('/api/v1/me/notification-preferences')).status())
    .toBe(200);
});

test('settings with the privacy controls has no serious accessibility violations', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Delete…' }).click();
  expect(await axeSerious(page)).toEqual([]);
});
