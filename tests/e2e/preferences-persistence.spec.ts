import { expect } from '@playwright/test';
import { test, deviceFixture } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { chooseLanguage, chooseTheme } from './support/preferences.js';
import { LANGUAGE_SWITCHER_IDS, THEME_SWITCHER_IDS } from '@/shared/ui/test-ids.js';
import { STARTUP_IDS } from '@/app/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { en } from '@/shared/lib/i18n/dictionaries/en.js';
import { appOrigin } from './runtime/app-origin.js';

async function saved() {
  const result = await deviceFixture().relay.db.pool.query(
    'SELECT p.language,p.theme FROM user_preferences p JOIN users u ON u.id=p.owner_id WHERE u.telegram_id=$1',
    ['801'],
  );

  return result.rows[0];
}

test('restores server choices in a fresh browser and keeps another account on its defaults', async ({
  page,
  browser,
}) => {
  await identity(page, '801', 'ru');
  await page.goto('/');
  await chooseLanguage(page, 'en');
  await chooseTheme(page, 'dark');
  await expect.poll(saved).toEqual({ language: 'en', theme: 'dark' });
  const second = await browser.newContext();
  const fresh = await second.newPage();

  try {
    await identity(fresh, '801', 'ru');
    await fresh.goto(appOrigin);
    await expect(fresh.getByTestId(LANGUAGE_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'en');
    await expect(fresh.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'dark');
    await fresh.evaluate(() => localStorage.clear());
    await fresh.reload();
    await expect(fresh.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'dark');
    await chooseTheme(fresh, 'auto');
    await expect.poll(saved).toEqual({ language: 'en', theme: 'auto' });
    await page.reload();
    await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'auto');
    const other = await second.newPage();

    await identity(other, '802', 'ru');
    await other.goto(appOrigin);
    await expect(other.getByTestId(LANGUAGE_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'ru');
    await expect(other.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'auto');
    await expect.poll(saved).toEqual({ language: 'en', theme: 'auto' });
  } finally {
    await second.close();
  }
});

test('saved preferences finish loading before settings become interactive', async ({ page }) => {
  await identity(page, '801', 'ru');

  let release: () => void = () => {};

  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/preferences', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await blocked;
    await route.fulfill({ json: { language: 'ru', theme: 'light' } });
  });

  await page.goto('/');
  await expect(page.getByTestId(STARTUP_IDS.root)).toBeVisible();
  release();
  await chooseLanguage(page, 'en');
  await chooseTheme(page, 'dark');
  await expect.poll(saved).toEqual({ language: 'en', theme: 'dark' });
  await expect(page.getByTestId(LANGUAGE_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'en');
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'dark');
});

test('fast changes remain ordered while a save is in flight', async ({ page }) => {
  await identity(page, '801', 'en');

  let release: () => void = () => {};

  let held = false;

  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/preferences', async (route) => {
    if (route.request().method() === 'PATCH' && !held) {
      held = true;
      await blocked;
    }

    await route.continue();
  });

  await page.goto('/');
  await chooseTheme(page, 'dark');
  await chooseLanguage(page, 'ru');
  await chooseTheme(page, 'light');
  await chooseLanguage(page, 'en');
  await chooseTheme(page, 'auto');
  release();
  await expect.poll(saved).toEqual({ language: 'en', theme: 'auto' });
  await page.reload();
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'auto');
});

test('a failed save remains visible, survives reopening, and reaches the server after recovery', async ({
  page,
}) => {
  await identity(page, '801', 'en');

  await page.route('**/preferences', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR' } })
      : route.continue(),
  );

  await page.goto('/');
  await chooseTheme(page, 'dark');
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(en.preferencesSaveFailed);
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'dark');
  await page.unroute('**/preferences');
  await page.reload();
  await expect.poll(saved).toEqual({ language: null, theme: 'dark' });
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'dark');
});

test('reopening with a failed preferences load immediately restores the unsaved language and theme', async ({
  page,
}) => {
  await identity(page, '801', 'ru');
  let reopening = false;

  await page.route('**/preferences', (route) =>
    route.request().method() === 'PATCH' || reopening
      ? route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR' } })
      : route.continue(),
  );

  await page.goto('/');
  await chooseLanguage(page, 'en');
  await chooseTheme(page, 'dark');
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(en.preferencesSaveFailed);
  reopening = true;
  await page.reload();
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(en.preferencesLoadFailed);
  await expect(page.getByTestId(LANGUAGE_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'en');
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'dark');
});
