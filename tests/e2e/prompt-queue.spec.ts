import { expect } from '@playwright/test';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { test, delivered, deviceFixture } from './support/relay-fixture.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';

async function sourceStatus(status: 'running' | 'idle') {
  const { sockets, deviceId, relay } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[0]!.status = status;
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await expect.poll(async () => (await relay.db.pool.query("SELECT data->>'status' AS status FROM sessions WHERE id='terminal-session'")).rows[0]?.status).toBe(status);
}

test('keeps Enter available during work and delivers queued messages in source-ready order', async ({ page }) => {
  await sourceStatus('running');
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.prompt).fill('First queued instruction');
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
  await page.getByTestId(COMMAND_IDS.prompt).fill('Second queued instruction');
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(2);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  expect(delivered).toHaveLength(0);
  await sourceStatus('idle');
  await expect.poll(() => delivered.length).toBe(1);
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('Second queued instruction');
  expect(delivered[0]!.action).toMatchObject({ type: 'prompt', text: 'First queued instruction' });
  await sourceStatus('running');
  await sourceStatus('idle');
  await expect.poll(() => delivered.length).toBe(2);
  await expect(page.getByTestId(COMMAND_IDS.queue)).toHaveCount(0);
  expect(delivered[1]!.action).toMatchObject({ type: 'prompt', text: 'Second queued instruction' });
});

test('can cancel an unsent message without delivering it later', async ({ page }) => {
  await sourceStatus('running');
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Cancel this queued instruction');
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(1);
  await page.getByTestId(COMMAND_IDS.cancelQueued).click();
  await expect(page.getByTestId(COMMAND_IDS.queue)).toHaveCount(0);
  await sourceStatus('idle');
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
  expect(delivered).toHaveLength(0);
});
