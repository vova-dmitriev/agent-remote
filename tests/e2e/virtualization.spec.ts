import { loadEarlierMessages } from "./support/history-pages.js";
import { expect } from '@playwright/test';
import { test, publishMessages } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { scrollSettled } from './support/scroll-settled.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { MARKDOWN_IDS } from '../../apps/mini-app/src/shared/ui/markdown/test-ids.js';

import { SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

test('reading stays anchored through the 500-message cap and earlier message growth', async ({ page }) => {
  // Publishing 500 events and paging them in takes about 20 s even on an idle machine.
  test.setTimeout(90000);

  const now = Date.now();

  const messages = Array.from({ length: 500 }, (_, index) => ({
    id: 'capped-' + index,
    role: 'assistant' as const,
    text: 'Synthetic capped message ' + index,
    occurredAt: now + index,
  }));

  await publishMessages(messages);
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.marker)).toHaveCount(100);
  await loadEarlierMessages(page, 500);
  await expect(page.getByTestId(SESSION_FEED_IDS.marker)).toHaveCount(500);
  await expect.poll(() => page.getByTestId(SESSION_FEED_IDS.message).count()).toBeLessThan(30);
  const marker = byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'capped-250' });
  const message = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'capped-250' });

  await marker.click();
  await expect(message).toBeVisible();
  const targetTop = await page.getByTestId(SESSION_FEED_IDS.root).evaluate(node => node.getBoundingClientRect().top + 22);

  await expect.poll(async () => Math.abs(await message.evaluate(node => node.getBoundingClientRect().top) - targetTop)).toBeLessThan(2);
  await scrollSettled(page.getByTestId(SESSION_FEED_IDS.root));
  const position = await message.evaluate((node) => node.getBoundingClientRect().top);

  await publishMessages([
    { id: 'capped-500', role: 'assistant', text: 'Newest capped message', occurredAt: now + 500 },
  ]);

  await expect(byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'capped-0' })).toHaveCount(0);

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(2);

  await publishMessages([{ ...messages[10]!, text: 'Earlier message grew. '.repeat(100) }]);
  await byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'capped-10' }).hover();
  await expect(page.getByTestId(SESSION_FEED_IDS.previewText)).toContainText('Earlier message grew.');

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(2);

  await publishMessages([
    { ...messages[249]!, text: '```typescript\n' + 'const measured = true;\n'.repeat(50) + '```' },
  ]);

  await expect(
    byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'capped-249' }).getByTestId(
      MARKDOWN_IDS.codeBlock,
    ),
  ).toBeAttached();

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(2);

  await byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'capped-249' })
    .getByTestId(MARKDOWN_IDS.code)
    .evaluate((node) => {
      node.style.fontSize = '20px';
      node.style.lineHeight = '2';
    });

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(2);

  // Reaching the top loads capped-0 and trims capped-500 off the 500-message window, so 500 is visited before 1.
  for (const index of [500, 1, 10, 400, 250]) {
    const target = byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'capped-' + index });

    await target.click();
    await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'capped-' + index })).toBeVisible();

    const viewportTop = await page
      .getByTestId(SESSION_FEED_IDS.root)
      .evaluate((node) => node.getBoundingClientRect().top + 22);

    await expect
      .poll(async () => {
        const firstVisible = await page
          .getByTestId(SESSION_FEED_IDS.message)
          .evaluateAll(
            (nodes, top) =>
              nodes
                .find((node) => node.getBoundingClientRect().bottom > top)
                ?.getAttribute('data-message-id'),
            viewportTop,
          );

        const atBottom = await page.getByTestId(SESSION_FEED_IDS.root).evaluate(
          (node) => node.scrollHeight - node.scrollTop - node.clientHeight <= 1,
        );

        return byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': atBottom ? 'capped-500' : firstVisible! }).getAttribute(
          'aria-current',
        );
      })
      .toBe('true');

    await expect.poll(() => page.getByTestId(SESSION_FEED_IDS.message).count()).toBeLessThan(30);
  }

  await marker.press('End');
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'capped-500' })).toBeVisible();
  await byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'capped-500' }).press('Home');
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'capped-1' })).toBeVisible();
});
