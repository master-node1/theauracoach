import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/** dev-auth stands in for Cognito and exposes the codes it would have emailed (test only). */
const DEV_AUTH = process.env.OIDC_DOMAIN_URL ?? 'http://localhost:4100';
const PASSWORD = 'Correct-Horse-42';

const email = (label: string) =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function inbox(request: APIRequestContext, address: string, kind: 'signUp' | 'reset') {
  const res = await request.get(`${DEV_AUTH}/test/codes?email=${encodeURIComponent(address)}`);
  const code = ((await res.json()) as Record<string, string>)[kind];
  expect(code, `${kind} code for ${address}`).toMatch(/^\d{6}$/);
  return code as string;
}

async function signUp(page: Page, address: string) {
  await page.goto('/auth/sign-in');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await expect(page.getByText(`We sent a 6-digit code to ${address}`)).toBeVisible();
}

async function signInWithPassword(page: Page, address: string, password: string) {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('signs up with email, enters the code and lands in the app', async ({ page, request }) => {
  const address = email('signup');
  await signUp(page, address);

  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.locator('p.auth-error')).toContainText(/code is not right|code has expired/);

  await page.getByRole('button', { name: 'Send a new code' }).click();
  await expect(page.getByRole('status')).toContainText('We sent a new code');
  await page.getByLabel('Code').fill(await inbox(request, address, 'signUp'));
  await page.getByRole('button', { name: 'Verify email' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('me-email')).toHaveText(address);
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).toBe('');
});

test('explains a weak password and a taken email', async ({ page }) => {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email('weak'));
  await page.getByLabel('Password').fill('short');
  await expect(page.getByText(/Use at least 10 characters/)).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('p.auth-error')).toContainText('Use at least 10 characters');

  const taken = email('taken');
  await signUp(page, taken);
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(taken);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('p.auth-error')).toContainText('already exists');
});

test('resets a forgotten password; the old one stops working', async ({ page, request }) => {
  const address = email('reset');
  await signUp(page, address);
  await page.getByLabel('Code').fill(await inbox(request, address, 'signUp'));
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.context().clearCookies();

  await page.goto('/auth/sign-in');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(address);
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page).toHaveURL(/\/auth\/reset$/);
  await expect(page.getByLabel('Email')).toHaveValue(address);
  await page.getByLabel('Code').fill(await inbox(request, address, 'reset'));
  await page.getByLabel('New password').fill('Brand-New-Pass-9');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in\?reset=1$/);
  await expect(page.getByRole('status')).toContainText('password is changed');

  await signInWithPassword(page, address, PASSWORD);
  await expect(page.locator('p.auth-error')).toContainText('do not match');
  await signInWithPassword(page, address, 'Brand-New-Pass-9');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('me-email')).toHaveText(address);
});

test('sign out of all devices ends the other sessions too', async ({ browser, request }) => {
  const address = email('everywhere');
  const laptop = await browser.newPage();
  await signUp(laptop, address);
  await laptop.getByLabel('Code').fill(await inbox(request, address, 'signUp'));
  await laptop.getByRole('button', { name: 'Verify email' }).click();
  await expect(laptop).toHaveURL(/\/$/);

  const phone = await (await browser.newContext()).newPage();
  await signInWithPassword(phone, address, PASSWORD);
  await expect(phone).toHaveURL(/\/$/);
  expect((await phone.request.get('/api/v1/me')).status()).toBe(200);

  await laptop.goto('/settings');
  await laptop.getByRole('button', { name: 'Sign out of all devices' }).click();
  await expect(laptop).toHaveURL(/\/auth\/sign-in/);

  // The other browser's access token has not expired, but the API now refuses it, and its
  // refresh token was revoked, so it is sent back to sign-in.
  expect((await phone.request.get('/api/v1/me')).status()).toBe(401);
});

test('hides Google and Apple when they are not configured', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await expect(page.getByRole('link', { name: /Continue with (Google|Apple)/ })).toHaveCount(0);
});
