import { chooseLanguage, chooseTheme } from '../support/ui/preferences.js';
import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { THEME_SWITCHER_IDS, LANGUAGE_SWITCHER_IDS } from '@/shared/ui/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

const dark = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));

test('auto follows system changes when Telegram does not specify a theme', async ({ page }) => {
  await identity(page, '801');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'auto');
  await expect.poll(() => dark(page)).toBe(true);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => dark(page)).toBe(false);
});

test('Telegram takes priority in auto; manual light overrides its dark palette and persists', async ({
  page,
}) => {
  await identity(page, '801');
  await page.emulateMedia({ colorScheme: 'dark' });

  await page.addInitScript(() => {
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        document.documentElement.style.setProperty('--tg-theme-bg-color', '#ffffff');
        document.documentElement.style.setProperty('--tg-theme-text-color', '#000000');
      },
      { once: true },
    );

    Object.assign(window.Telegram!.WebApp, {
      colorScheme: 'light',
      themeParams: { bg_color: '#ffffff', text_color: '#000000' },
      onEvent(name: string, callback: () => void) {
        window.addEventListener('synthetic-' + name, callback);
      },
      offEvent(name: string, callback: () => void) {
        window.removeEventListener('synthetic-' + name, callback);
      },
    });
  });

  await page.goto('/');
  await expect.poll(() => dark(page)).toBe(false);

  await page.evaluate(() => {
    Object.assign(window.Telegram!.WebApp, {
      colorScheme: 'dark',
      themeParams: {
        bg_color: '#000000',
        text_color: '#ffffff',
        button_color: '#aa3322',
        link_color: '#aa3322',
      },
    });

    window.dispatchEvent(new Event('synthetic-themeChanged'));
  });

  await expect.poll(() => dark(page)).toBe(true);

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(23, 25, 29)');

  await chooseTheme(page, 'light');
  await expect.poll(() => dark(page)).toBe(false);

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(247, 249, 252)');

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--tg-theme-bg-color', '#000000');
    document.documentElement.style.setProperty('--tg-theme-text-color', '#ffffff');
    window.dispatchEvent(new Event('synthetic-themeChanged'));
  });

  await expect.poll(() => dark(page)).toBe(false);

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(247, 249, 252)');

  await page.reload();
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'light');
  await expect.poll(() => dark(page)).toBe(false);

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(247, 249, 252)');

  await chooseTheme(page, 'auto');
  await expect.poll(() => dark(page)).toBe(false);
  await chooseTheme(page, 'dark');
  await expect.poll(() => dark(page)).toBe(true);

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(23, 25, 29)');
});

test('session hides all preferences and logout; home restores them without losing the draft', async ({
  page,
}) => {
  await identity(page, '801', 'en');
  await page.goto('/');
  await chooseTheme(page, 'dark');
  const card = byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' });

  await card.hover();
  await expect.poll(() => card.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(0, 152, 255)');
  await page.screenshot({ path: 'artifacts/home-theme-dark.png', fullPage: true, animations: 'disabled' });
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic retained draft');
  await expect(page.getByTestId(LANGUAGE_SWITCHER_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SHELL_IDS.logout)).toHaveCount(0);
  await expect(page.getByTestId(THEME_SWITCHER_IDS.root)).toHaveCount(0);
  await expect.poll(() => dark(page)).toBe(true);

  await page.screenshot({
    path: 'artifacts/session-without-preferences.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await expect(page.getByTestId(SHELL_IDS.logout)).toBeVisible();
  await chooseLanguage(page, 'ru');
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'dark');
  await expect(page.getByTestId(THEME_SWITCHER_IDS.root)).toHaveAttribute('aria-label', 'Тема');
  await chooseTheme(page, 'light');
  await page.screenshot({ path: 'artifacts/home-theme-light.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 640 });

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);

  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Synthetic retained draft');
  await expect.poll(() => dark(page)).toBe(false);
});

test('theme switching works with blocked local storage', async ({ page }) => {
  await identity(page, '801');

  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    }),
  );

  await page.goto('/');
  await chooseTheme(page, 'dark');
  await expect.poll(() => dark(page)).toBe(true);
  await chooseTheme(page, 'light');
  await expect.poll(() => dark(page)).toBe(false);
});

test('the SDK default light value outside Telegram does not override the system theme', async ({ page }) => {
  await identity(page, '801', 'en', '');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => Object.assign(window.Telegram!.WebApp, { colorScheme: 'light' }));
  await page.goto('/');
  await expect(page.getByTestId(THEME_SWITCHER_IDS.trigger)).toHaveAttribute('data-value', 'auto');
  await expect.poll(() => dark(page)).toBe(true);
});
