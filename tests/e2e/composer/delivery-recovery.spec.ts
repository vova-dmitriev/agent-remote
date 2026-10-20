import { expect } from '@playwright/test';
import type { ClientCommand } from '@protocol';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';
import { setCommandOutcome, releaseCommandOutcome } from '../runtime/command-outcome.js';
import { test, delivered, deviceFixture } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';

async function auditCount() {
  const { relay } = deviceFixture();
  const result = await relay.db.pool.query('SELECT count(*) FROM command_audit');

  return Number(result.rows[0].count);
}

test('lost command HTTP response uses a confirmed WebSocket receipt without another lookup or delivery', async ({
  page,
}) => {
  let posts = 0;

  let responseLost = () => {};

  const responseFinished = new Promise<void>((resolve) => {
    responseLost = resolve;
  });

  const lookups: string[] = [];

  await page.route('**/commands', async (route) => {
    posts++;
    await route.fetch();
    await expect(page.getByTestId(SHELL_IDS.receipt)).toHaveText('Delivered to session');
    await route.abort('connectionfailed');
    responseLost();
  });

  await page.route('**/commands/*', async (route) => {
    lookups.push(route.request().url());
    await route.continue();
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Resolve an ambiguous HTTP response');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  await expect(page.getByTestId(SHELL_IDS.receipt)).toHaveText('Delivered to session');
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toHaveCount(0);
  await responseFinished;
  expect(posts).toBe(1);
  expect(lookups).toHaveLength(0);
  expect(delivered).toHaveLength(1);
  expect(await auditCount()).toBe(1);
});

test('manual retry checks one command while additional messages stay queued', async ({
  page,
}) => {
  const submitted: ClientCommand[] = [];
  let statusAvailable = false;

  let finishLookup = () => {};

  const lookupFinished = new Promise<void>(resolve => { finishLookup = resolve; });

  setCommandOutcome('held');

  await page.route('**/commands', async (route) => {
    submitted.push(route.request().postDataJSON() as ClientCommand);
    await route.fetch();
    await route.abort('connectionfailed');
  });

  await page.route('**/commands/*', async (route) => {
    if (statusAvailable) {
      await releaseCommandOutcome();
      await route.continue();
      finishLookup();
    } else await route.abort('connectionfailed');
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Original uncertain command');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeVisible();
  await page.getByTestId(COMMAND_IDS.prompt).fill('A different unsent side effect');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeEnabled();
  expect(submitted).toHaveLength(1);
  statusAvailable = true;
  await page.getByTestId(COMMAND_IDS.retryQueued).click();
  await lookupFinished;
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(1);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('A different unsent side effect');
  expect(submitted).toHaveLength(1);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]!.commandId).toBe(submitted[0]!.commandId);
  expect(await auditCount()).toBe(1);
});

test('manual retry resubmits the same ID after real NOT_FOUND and delivers exactly once', async ({
  page,
}) => {
  const submitted: ClientCommand[] = [];
  const lookupStatuses: number[] = [];

  await page.route('**/commands', async (route) => {
    submitted.push(route.request().postDataJSON() as ClientCommand);

    if (submitted.length === 1) await route.abort('connectionfailed');
    else await route.continue();
  });

  await page.route('**/commands/*', async (route) => {
    const response = await route.fetch();

    lookupStatuses.push(response.status());
    await route.fulfill({ response });
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Retry one durable command ID');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeVisible();
  expect(submitted).toHaveLength(1);
  expect(delivered).toHaveLength(0);
  await page.getByTestId(COMMAND_IDS.retryQueued).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  await expect.poll(() => delivered.length).toBe(1);
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(lookupStatuses).toEqual([404, 404]);
  expect(await auditCount()).toBe(1);
});
