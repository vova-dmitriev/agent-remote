import { chooseLanguage } from './support/preferences.js';
import { test, expect } from '@playwright/test';
import { LANGUAGE_SWITCHER_IDS } from '@/shared/ui/test-ids.js';
import { SIGN_IN_IDS } from '@/pages/sign-in/config/test-ids.js';

test('language choice updates signed-out UI and survives a reload', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js**', (route) =>
    route.fulfill({ body: '', contentType: 'application/javascript' }),
  );

  await page.goto('/');
  await chooseLanguage(page, 'en');
  await expect(page.getByTestId(SIGN_IN_IDS.title)).toContainText('Work stays on your Mac.');
  await expect(page.getByTestId(LANGUAGE_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'en');
  await page.reload();
  await expect(page.getByTestId(SIGN_IN_IDS.title)).toContainText('Work stays on your Mac.');
  await chooseLanguage(page, 'ru');
  await expect(page.getByTestId(SIGN_IN_IDS.title)).toContainText('Работа остаётся на Mac.');
});

test('language switching still works when local storage is unavailable', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js**', (route) =>
    route.fulfill({ body: '', contentType: 'application/javascript' }),
  );

  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    }),
  );

  await page.goto('/');
  await chooseLanguage(page, 'ru');
  await expect(page.getByTestId(SIGN_IN_IDS.title)).toContainText('Работа остаётся на Mac.');
  await chooseLanguage(page, 'en');
  await expect(page.getByTestId(SIGN_IN_IDS.title)).toContainText('Work stays on your Mac.');
});
