import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * The en-XA pseudo-locale (accented, ~40% longer, bracketed) on the shell and Settings: every
 * string comes from the catalogue and nothing overflows. Needs I18N_PSEUDO_LOCALE=true on the
 * server (playwright.config.ts sets it).
 */

const email = () => `pseudo-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
const PSEUDO = /^\[.*~+\]$/s;

async function usePseudoLocale(page: Page) {
  const url = new URL(page.url());
  await page.context().addCookies([{ name: 'aura-locale', value: 'en-XA', url: url.origin }]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
}

/**
 * Catalogue text that is cut off: elements showing pseudo text that clip it. User data such as a
 * long email may be ellipsised on purpose, so it is not checked.
 */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) {
      problems.push(`page scrolls sideways: ${doc.scrollWidth} > ${window.innerWidth}`);
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *, nav *'))) {
      if (!el.offsetParent || !/\[[^\]]*~+\]/.test(el.textContent ?? '')) continue;
      const style = getComputedStyle(el);
      const clips =
        ['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis';
      if (
        clips &&
        el.scrollWidth > el.clientWidth + 1 &&
        !el.classList.contains('visually-hidden')
      ) {
        problems.push(
          `${el.tagName.toLowerCase()}.${el.className}: "${el.textContent.trim().slice(0, 40)}"`,
        );
      }
    }
    return problems;
  });
}

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

test('renders the shell and Settings in en-XA without hard-coded text or layout breaks', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Continue' }).click();
  await page.getByLabel('Email').fill(email());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/$/);
  await usePseudoLocale(page);

  // Shell: the main nav and the Today heading come from the pseudo catalogue.
  const nav = page.getByRole('navigation', { name: PSEUDO });
  await expect(nav).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PSEUDO);
  await expect(page).toHaveTitle(/^\[.*\]$/);
  expect(await layoutProblems(page)).toEqual([]);
  await snapshot(page, testInfo, 'today-en-XA');

  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PSEUDO);
  for (const heading of await page.getByRole('heading', { level: 2 }).allTextContents()) {
    expect(heading).toMatch(PSEUDO);
  }
  expect(await layoutProblems(page)).toEqual([]);
  await snapshot(page, testInfo, 'settings-en-XA');
});

test('ignores the pseudo-locale cookie for locales it does not offer', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page
    .context()
    .addCookies([{ name: 'aura-locale', value: 'fr-FR', url: new URL(page.url()).origin }]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-IN');
  await expect(page.getByRole('link', { name: 'Continue' })).toBeVisible();
});
