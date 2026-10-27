import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const email = () => `settings-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function openSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Continue' }).click();
  await page.getByLabel('Email').fill(email());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'Settings' }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
}

test('changes display name, theme and a consent, and keeps them after reload', async ({ page }) => {
  await openSettings(page);

  await page.getByLabel('Display name').fill('Priya');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByTestId('settings-name')).toHaveText('Priya');

  await page.getByRole('radio', { name: 'Dark' }).check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const coach = page.getByRole('switch', { name: /AI coach/ });
  await expect(coach).toHaveAttribute('aria-checked', 'false');
  await coach.click();
  await expect(coach).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status')).toHaveText('Saved');

  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Priya');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('switch', { name: /AI coach/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  const consents = await (await page.request.get('/api/v1/me/consents')).json();
  expect(consents).toEqual([
    expect.objectContaining({ purpose: 'AI_COACH', granted: true, policyVersion: '2026-10' }),
  ]);
});

test('has no serious accessibility violations', async ({ page }) => {
  await openSettings(page);
  const results = await new AxeBuilder({ page }).include('main').analyze();
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact!));
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
