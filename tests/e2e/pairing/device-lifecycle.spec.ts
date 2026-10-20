import { expect } from '@playwright/test';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { DEVICE_ACCESS_IDS } from '@/features/device-access/config/test-ids.js';
import { PAIR_DEVICE_IDS } from '@/features/pair-device/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import {
  SESSION_PAGE_IDS,
  SESSION_FEED_IDS,
  PERMISSION_IDS,
} from '@/pages/session/config/test-ids.js';
import { SESSION_AVAILABILITY_IDS } from '@/entities/session/config/availability-test-ids.js';
import { identity } from '../support/relay/identity.js';
import { test, publishMessages, delivered } from '../support/relay/relay-fixture.js';
import { byTestId } from '../support/ui/testid.js';
import { dropDevice, restoreDevice } from '../product/device.js';
import { controlledAppSocket } from '../product/browser.js';

const history = [
  { id: 'retained', role: 'assistant' as const, text: 'Retained synthetic history', occurredAt: Date.now() },
];

test('browser revoke returns to pairing and clears the selected session, history and draft', async ({
  page,
}) => {
  await publishMessages(history);
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText(history[0]!.text);
  await page.getByTestId(COMMAND_IDS.prompt).fill('Revoked owner draft');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await page.getByTestId(DEVICE_ACCESS_IDS.toggle).click();
  await page.getByTestId(DEVICE_ACCESS_IDS.revoke).click();
  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveCount(0);
});

test('device loss disables commands and removes stale permissions while restoration retains context', async ({
  page,
}) => {
  await publishMessages(history);
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Continue after restoring the Mac');
  await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(1);
  await dropDevice();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeDisabled();
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await expect(page.getByTestId(COMMAND_IDS.interrupt)).toBeDisabled();
  await page.getByTestId(COMMAND_IDS.actionsTrigger).press('Escape');
  await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText(history[0]!.text);

  await expect(page.getByTestId(SESSION_AVAILABILITY_IDS.trigger)).toHaveAttribute(
    'data-availability',
    'offline',
  );

  await restoreDevice();

  await expect(page.getByTestId(SESSION_AVAILABILITY_IDS.trigger)).toHaveAttribute(
    'data-availability',
    'online',
  );

  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Continue after restoring the Mac');
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText(history[0]!.text);
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.filter((command) => command.action.type === 'prompt').length).toBe(1);
});

test('app WebSocket reconnect disables commands and retains selection, draft and history', async ({
  page,
}) => {
  const socket = await controlledAppSocket(page);

  await publishMessages(history);
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Draft across app reconnect');
  socket.disconnect();

  await expect(page.getByTestId(SESSION_AVAILABILITY_IDS.trigger)).toHaveAttribute(
    'data-availability',
    'offline',
  );

  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeDisabled();
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
  await expect(page.getByTestId(PERMISSION_IDS.allow)).toBeDisabled();
  socket.reconnect();

  await expect(page.getByTestId(SESSION_AVAILABILITY_IDS.trigger)).toHaveAttribute(
    'data-availability',
    'online',
  );

  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Draft across app reconnect');
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText(history[0]!.text);
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText('Synthetic sprint fixes');
});
