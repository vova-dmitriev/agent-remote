import { loadEarlierMessages } from "../support/ui/history-pages.js";
import { expect } from '@playwright/test';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { SESSION_AVAILABILITY_IDS } from '@/entities/session/config/availability-test-ids.js';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { expectLoadedMessages } from '../support/ui/rail.js';
import { controlledAppSocket } from '../product/browser.js';

const message = (id: string, text: string, occurredAt = Date.now()) => ({
  id,
  text,
  occurredAt,
  role: 'assistant' as const,
});

test('reconnect reloads authoritative history including messages missed while the app socket was closed', async ({
  page,
}) => {
  const socket = await controlledAppSocket(page);
  let historyLoads = 0;

  page.on('request', (request) => {
    if (request.url().includes('/sessions/terminal-session/events')) historyLoads++;
  });

  await publishMessages([message('before-disconnect', 'Before reconnect')]);
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText('Before reconnect');
  await page.getByTestId(COMMAND_IDS.prompt).fill('History recovery draft');
  socket.disconnect();

  await expect(page.getByTestId(SESSION_AVAILABILITY_IDS.trigger)).toHaveAttribute(
    'data-availability',
    'offline',
  );

  await publishMessages([message('missed-while-offline', 'Arrived while app was offline', Date.now() + 1)]);
  socket.reconnect();

  await expect(page.getByTestId(SESSION_AVAILABILITY_IDS.trigger)).toHaveAttribute(
    'data-availability',
    'online',
  );

  await expectLoadedMessages(page, 2);

  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText([
    'Before reconnect',
    'Arrived while app was offline',
  ]);

  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('History recovery draft');
  expect(historyLoads).toBeGreaterThanOrEqual(2);
});

test('history HTTP loads the latest page first and fetches older messages on demand without duplicates', async ({
  page,
}) => {
  const now = Date.now();

  // The owner's messages: the rail marks each one, so its markers list every loaded message.
  const messages = Array.from({ length: 205 }, (_, index) => ({
    ...message('paged-' + index, 'Paged message ' + index, now + index),
    role: 'user' as const,
  }));

  const pages: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/sessions/terminal-session/events')) pages.push(request.url());
  });

  await publishMessages(messages);
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expectLoadedMessages(page, 100);
  expect(pages).toHaveLength(1);
  await loadEarlierMessages(page,205);
  await expectLoadedMessages(page, 205);

  const ids = await page
    .getByTestId(SESSION_FEED_IDS.marker)
    .evaluateAll((nodes) => nodes.flatMap((node) => node.getAttribute('data-message-ids')!.split(' ')));

  expect(ids).toEqual(messages.map((item) => item.id));
  expect(new Set(ids).size).toBe(205);
  expect(new Set(pages).size).toBe(3);
  expect(new Set(pages.filter((url) => url.includes('?before='))).size).toBe(2);
});

test('a late history response cannot replace the newly selected session', async ({ page }) => {
  await publishMessages([message('old-session-content', 'Old session content')]);
  await publishMessages([message('new-session-content', 'Current chat content')], 'chat-session');
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/sessions/terminal-session/events**', async (route) => {
    const response = await route.fetch();

    await gate;
    await route.fulfill({ response });
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText('Current chat content');
  release();
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText('Current chat content');
  await expectLoadedMessages(page, 1);
});

test('history failure preserves selection and recovers by selecting the session again', async ({ page }) => {
  await publishMessages([message('recovered-history', 'History restored after retry')]);
  let unavailable = true;

  await page.route('**/sessions/terminal-session/events**', async (route) => {
    if (unavailable) await route.abort('connectionfailed');
    else await route.continue();
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(
    'Could not load this session’s history. Select the session again to retry.',
  );

  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  unavailable = false;
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText('History restored after retry');
});
