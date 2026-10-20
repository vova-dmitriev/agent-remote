import { expect } from '@playwright/test';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { DEVICE_ACCESS_IDS } from '@/features/device-access/config/test-ids.js';
import { PAIR_DEVICE_IDS } from '@/features/pair-device/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { test, delivered } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { currentSnapshot } from './product/device.js';
import { pairReplacementDevice } from './product/pairing.js';
import { setCommandOutcome } from './runtime/command-outcome.js';

test('revoke discards the old draft before a newly paired Mac reuses its session identity', async ({
  page,
}) => {
  const snapshot = await currentSnapshot();

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Private draft belonging to the revoked Mac');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await page.getByTestId(DEVICE_ACCESS_IDS.toggle).click();
  await page.getByTestId(DEVICE_ACCESS_IDS.revoke).click();
  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toBeVisible();
  await pairReplacementDevice(page, snapshot);
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
});

test('revoke discards an uncertain old command so a replacement Mac can receive a new command', async ({
  page,
}) => {
  const snapshot = await currentSnapshot();

  setCommandOutcome('held');

  await page.route('**/commands', async (route) => {
    await route.fetch();
    await route.abort('connectionfailed');
  });

  await page.route('**/commands/*', (route) => route.abort('connectionfailed'));
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Old uncertain command');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeVisible();
  await expect.poll(() => delivered.length).toBe(1);
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await page.getByTestId(DEVICE_ACCESS_IDS.toggle).click();
  await page.getByTestId(DEVICE_ACCESS_IDS.revoke).click();
  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toBeVisible();
  const deviceId = await pairReplacementDevice(page, snapshot);

  setCommandOutcome('dispatched');

  await page.unroute('**/commands');
  await page.unroute('**/commands/*');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('New device command');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.length).toBe(2);
  expect(delivered[1]!.target.deviceId).toBe(deviceId);
  expect(delivered[1]!.action).toEqual({ type: 'prompt', text: 'New device command' });
  expect(delivered[1]!.commandId).not.toBe(delivered[0]!.commandId);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toHaveCount(0);
});
