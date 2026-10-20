import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { setSessionLanguage } from '../support/ui/session-language.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

for (const empty of [false, true]) {
  test(`history skeleton preserves feed and composer geometry until ${empty ? 'empty' : 'populated'} response`, async ({
    page,
  }) => {
    if (!empty)
      await publishMessages([
        { id: 'loaded', text: 'Synthetic loaded history', role: 'assistant', occurredAt: Date.now() },
      ]);
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
    const frame = page.getByTestId(SESSION_FEED_IDS.frame);
    const prompt = page.getByTestId(COMMAND_IDS.prompt);

    await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toBeVisible();
    await expect(frame).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toHaveCount(0);
    const before = { frame: await frame.boundingBox(), prompt: await prompt.boundingBox() };

    release();
    await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toHaveCount(0);
    if (empty) await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toBeVisible();
    else await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText('Synthetic loaded history');
    const after = { frame: await frame.boundingBox(), prompt: await prompt.boundingBox() };

    expect(before.frame).not.toBeNull();
    expect(before.prompt).not.toBeNull();
    expect(after.frame).not.toBeNull();
    expect(after.prompt).not.toBeNull();
    expect(Math.abs(after.frame!.y - before.frame!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.frame!.height - before.frame!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.prompt!.y - before.prompt!.y)).toBeLessThanOrEqual(1);
  });
}

test('stale rejected history cannot clear the next selection loading state', async ({ page }) => {
  let rejectOld!: () => void;
  let releaseCurrent!: () => void;

  const oldGate = new Promise<void>((resolve) => {
    rejectOld = resolve;
  });

  const currentGate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  await page.route('**/sessions/terminal-session/events**', async (route) => {
    await oldGate;
    await route.fulfill({ status: 503, json: { error: 'HISTORY_UNAVAILABLE' } });
  });

  await page.route('**/sessions/chat-session/events**', async (route) => {
    await currentGate;
    await route.fulfill({ json: [] });
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toBeVisible();
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toBeVisible();
  const oldResponse = page.waitForResponse((response) => response.url().includes('/terminal-session/events'));

  rejectOld();
  await oldResponse;
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toBeVisible();
  await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveCount(0);
  releaseCurrent();
  await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toBeVisible();
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toHaveCount(0);
});

test('reselection in another language ignores the earlier request and recovers after failure', async ({
  page,
}) => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;

  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });

  let requests = 0;

  await page.route('**/sessions/terminal-session/events**', async (route) => {
    const request = ++requests;

    if (request === 1) await firstGate;
    if (request === 2) {
      await secondGate;
      await route.fulfill({ status: 503, json: { error: 'HISTORY_UNAVAILABLE' } });
    } else await route.fulfill({ json: [] });
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toHaveAttribute('aria-label', 'Loading messages…');
  await expect.poll(() => requests).toBe(1);
  await setSessionLanguage(page, 'ru', 'terminal-session');

  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toHaveAttribute(
    'aria-label',
    'Загрузка сообщений…',
  );

  const firstResponse = page.waitForResponse((response) =>
    response.url().includes('/terminal-session/events'),
  );

  releaseFirst();
  await firstResponse;
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toBeVisible();
  await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toHaveCount(0);
  releaseSecond();
  await expect(page.getByTestId(COMMAND_IDS.notice)).toBeVisible();
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toHaveCount(0);
  await setSessionLanguage(page, 'en', 'terminal-session');
  await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toBeVisible();
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveCount(0);
});
