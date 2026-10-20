import { byTestId } from './support/testid.js';
import { setSessionLanguage } from './support/session-language.js';
import { expect } from '@playwright/test';
import { test, delivered } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '@/pages/sessions/config/test-ids.js';
import {
  SESSION_PAGE_IDS,
  SESSION_FEED_IDS,
  PERMISSION_IDS,
} from '@/pages/session/config/test-ids.js';
import { SIGN_IN_IDS } from '@/pages/sign-in/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { PAIR_DEVICE_IDS } from '@/features/pair-device/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';

test('mobile app preserves context, renders terminal literally and dispatches prompt/permission', async ({
  page,
}) => {
  await identity(page, '801');
  await page.goto('/');
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.title)).toBeVisible();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(SESSION_PAGE_IDS.terminal).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.terminal)).toHaveText('<script>alert(1)</script>');
  await page.getByTestId(COMMAND_IDS.prompt).fill('Продолжи исходную задачу');
  await page.getByTestId(COMMAND_IDS.send).click();

  await expect
    .poll(() =>
      delivered.some((c) => c.action.type === 'prompt' && c.action.text === 'Продолжи исходную задачу'),
    )
    .toBe(true);

  await page.getByTestId(PERMISSION_IDS.allow).click();

  await expect
    .poll(() =>
      delivered.some((c) => c.action.type === 'permission' && c.action.requestId === 'permission-one'),
    )
    .toBe(true);

  await page.screenshot({ path: 'test-results/mobile-session.png', fullPage: true });
  await page.screenshot({ path: 'artifacts/mini-app-mobile.png', fullPage: true });
});

test('Desktop Chat omits terminal and permissions and logout clears all owner data', async ({ page }) => {
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.terminal)).toHaveCount(0);
  await expect(page.getByTestId(PERMISSION_IDS.allow)).toHaveCount(0);
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await page.getByTestId(SHELL_IDS.logout).click();
  await expect(page.getByTestId(SIGN_IN_IDS.title)).toBeVisible();
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(0);
});

test('a second Telegram owner cannot see first owner sessions', async ({ page }) => {
  await identity(page, '802');
  await page.goto('/');
  await expect(page.getByTestId(PAIR_DEVICE_IDS.title)).toBeVisible();
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(0);
});

test('shows session-shaped loading placeholders before device data arrives', async ({ page }) => {
  await identity(page, '801');
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/devices', async (route) => {
    await gate;
    await route.continue();
  });

  await page.goto('/');
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.loading)).toBeVisible();
  await expect(page.getByTestId(SESSION_CARD_IDS.skeleton)).toHaveCount(3);
  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toHaveCount(0);
  release();
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(4);
});

test('logout prevents a delayed device response from restoring owner data', async ({ page }) => {
  await identity(page, '801');
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/devices', async (route) => {
    await gate;
    await route.fulfill({ json: [{ id: 'delayed-owner-device', last_seen_at: '1' }] });
  });

  await page.goto('/');
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.loading)).toBeVisible();
  await page.getByTestId(SHELL_IDS.logout).click();
  release();
  await expect(page.getByTestId(SIGN_IN_IDS.title)).toBeVisible();
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toHaveCount(0);
});

test('drafts stay with their session when navigating and a delayed send completes', async ({ page }) => {
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic draft for A');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic draft for B');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Synthetic draft for A');
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/commands', async (route) => {
    const response = await route.fetch();

    await gate;
    await route.fulfill({ response });
  });

  await page.getByTestId(COMMAND_IDS.send).click();
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  release();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Synthetic draft for B');
});

test('switching language preserves the selected session and draft without signing in again', async ({
  page,
}) => {
  await identity(page, '801', 'ru');
  let logins = 0;

  page.on('request', (request) => {
    if (request.url().endsWith('/auth/telegram')) logins++;
  });

  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Keep this original draft');
  await page.getByTestId(SESSION_PAGE_IDS.terminal).click();
  await setSessionLanguage(page, 'en', 'terminal-session', 'terminal');
  await expect(page.getByTestId(COMMAND_IDS.label)).toHaveText('Message this session');
  await expect(page.getByTestId(PERMISSION_IDS.allow)).toHaveText('Allow once');
  await expect(page.getByTestId(SESSION_FEED_IDS.terminal)).toHaveText('<script>alert(1)</script>');
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Keep this original draft');
  await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Ready for a message');
  await setSessionLanguage(page, 'ru', 'terminal-session');
  await expect(page.getByTestId(COMMAND_IDS.label)).toHaveText('Сообщение в эту сессию');
  expect(logins).toBe(1);
});
