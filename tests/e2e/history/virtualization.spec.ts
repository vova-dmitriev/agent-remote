import { loadEarlierMessages } from "../support/ui/history-pages.js";
import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { expectLoadedMessages, jumpNear, railMarker } from '../support/ui/rail.js';
import { scrollSettled } from '../support/ui/scroll-settled.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { MARKDOWN_IDS } from '@/shared/ui/markdown/test-ids.js';

import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';

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
  await expectLoadedMessages(page, 100);
  await loadEarlierMessages(page, 500);
  await expectLoadedMessages(page, 500);
  await expect.poll(() => page.getByTestId(SESSION_FEED_IDS.message).count()).toBeLessThan(30);
  const anchor = await jumpNear(page, 'capped-250');
  const message = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': anchor });

  await expect(message).toBeVisible();
  const targetTop = await page.getByTestId(SESSION_FEED_IDS.root).evaluate(node => node.getBoundingClientRect().top + 22);

  await expect.poll(async () => Math.abs(await message.evaluate(node => node.getBoundingClientRect().top) - targetTop)).toBeLessThan(2);
  await scrollSettled(page.getByTestId(SESSION_FEED_IDS.root));
  const position = await message.evaluate((node) => node.getBoundingClientRect().top);

  await publishMessages([
    { id: 'capped-500', role: 'assistant', text: 'Newest capped message', occurredAt: now + 500 },
  ]);

  await expect(railMarker(page, 'capped-0')).toHaveCount(0);

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(2);

  // Grow the message a rail marker starts with, so hovering that marker previews it.
  const grown = (await railMarker(page, 'capped-10').getAttribute('data-message-id'))!;

  await publishMessages([{ ...messages[Number(grown.split('-')[1])]!, text: 'Earlier message grew. '.repeat(100) }]);
  await byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': grown }).hover();
  await expect(page.getByTestId(SESSION_FEED_IDS.previewText)).toContainText('Earlier message grew.');

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(2);

  // The message right above the reading anchor grows when its code block renders and is measured.
  const above = messages[Number(anchor.split('-')[1]) - 1]!;

  await publishMessages([{ ...above, text: '```typescript\n' + 'const measured = true;\n'.repeat(50) + '```' }]);

  await expect(
    byTestId(page, SESSION_FEED_IDS.message, { 'message-id': above.id }).getByTestId(
      MARKDOWN_IDS.codeBlock,
    ),
  ).toBeAttached();

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(2);

  await byTestId(page, SESSION_FEED_IDS.message, { 'message-id': above.id })
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
    const target = await jumpNear(page, 'capped-' + index);

    await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': target })).toBeVisible();

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

        const active = await page.getByTestId(SESSION_FEED_IDS.rail).getAttribute('data-active-message-id');

        return active === (atBottom ? 'capped-500' : firstVisible);
      })
      .toBe(true);

    await expect.poll(() => page.getByTestId(SESSION_FEED_IDS.message).count()).toBeLessThan(30);
  }

  const markers = page.getByTestId(SESSION_FEED_IDS.marker);
  const last = (await markers.last().getAttribute('data-message-id'))!;
  const first = (await markers.first().getAttribute('data-message-id'))!;

  await railMarker(page, anchor).press('End');
  await expect(markers.last()).toBeFocused();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': last })).toBeVisible();
  await markers.last().press('Home');
  await expect(markers.first()).toBeFocused();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': first })).toBeVisible();
});
