import { defineConfig, devices } from '@playwright/test';

/**
 * Web smoke against the running stack (docker compose: gateway :8080, dev-auth :4100). Playwright
 * starts the built app on :3100; run `pnpm --filter @aura/web build` first.
 */
const port = 3100;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}/auth/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      APP_URL: `http://localhost:${port}`,
      API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:8080',
      OIDC_DOMAIN_URL: process.env.OIDC_DOMAIN_URL ?? 'http://localhost:4100',
      OIDC_ISSUER: process.env.OIDC_ISSUER ?? 'http://localhost:4100',
      OIDC_CLIENT_ID: 'aura-dev-client',
      IDENTITY_ENDPOINT: `${process.env.OIDC_DOMAIN_URL ?? 'http://localhost:4100'}/`,
      // Every test signs in from 127.0.0.1; the 10/min limit itself is covered by unit tests.
      AUTH_RATE_LIMIT_PER_MINUTE: '1000',
      // Test-only key for the throwaway session cookies of this run.
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'playwright-only-session-key-0123456789',
    },
  },
});
