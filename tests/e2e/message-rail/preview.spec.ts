import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { expectLoadedMessages, expectSettledRail, railMarker } from '../support/ui/rail.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';

test('one readable preview follows hovered and focused markers without changing the conversation', async ({
  page,
}) => {
  await publishMessages(
    Array.from({ length: 500 }, (_, index) => ({
      id: 'preview-' + index,
      role: index % 2 ? ('user' as const) : ('assistant' as const),
      text:
        'Synthetic preview ' + index + ' <script>literal text</script> ' + 'A readable snippet. '.repeat(30),
      occurredAt: 1700000000000 + index,
    })),
  );

  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expectLoadedMessages(page, 100);

  await expect(page.getByTestId(SESSION_FEED_IDS.preview)).toHaveCount(0);
  // A merged marker previews and jumps to its first message.
  await expectSettledRail(page);
  // The owner's messages are the odd ones here, and only they are marked.
  const marker = railMarker(page, 'preview-499');
  const target = (await marker.getAttribute('data-message-id'))!;
  const author = (id: string) => (Number(id.split('-').at(-1)) % 2 ? 'Ты' : 'Claude');
  const feed = page.getByTestId(SESSION_FEED_IDS.root);
  const position = await feed.evaluate((node) => node.scrollTop);

  await marker.hover();
  const preview = page.getByTestId(SESSION_FEED_IDS.preview);

  await expect(preview).toBeVisible();
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute('data-message-id', target);
  await expect(page.getByTestId(SESSION_FEED_IDS.previewAuthor)).toHaveText(author(target));
  await expect(page.getByTestId(SESSION_FEED_IDS.previewText)).toContainText('Synthetic preview ' + target.split('-').at(-1));
  await expect(marker).toHaveAttribute('aria-describedby', (await preview.getAttribute('id'))!);

  expect(
    await preview.evaluate((node) => ({
      left: node.getBoundingClientRect().left >= 8,
      right: node.getBoundingClientRect().right <= innerWidth - 8,
      top: node.getBoundingClientRect().top >= 8,
      bottom: node.getBoundingClientRect().bottom <= innerHeight - 8,
    })),
  ).toEqual({ left: true, right: true, top: true, bottom: true });

  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await page.getByTestId(SESSION_FEED_IDS.frame).hover({ position: { x: 60, y: 5 } });
  await marker.hover();
  await expect(preview).toBeVisible();

  await preview.hover();
  await preview.click();
  await expect(preview).toBeVisible();
  expect(await feed.evaluate((node) => node.scrollTop)).toBe(position);
  await page.getByTestId(SESSION_FEED_IDS.frame).hover({ position: { x: 60, y: 5 } });
  await expect(preview).toHaveCount(0);
  await page.keyboard.press('Tab');
  await marker.focus();
  await expect(preview).toBeVisible();
  const markers = page.getByTestId(SESSION_FEED_IDS.marker);
  const index = await markers.evaluateAll((nodes, id) => nodes.findIndex((node) => node.getAttribute('data-message-id') === id), target);
  const previous = (await markers.nth(index - 1).getAttribute('data-message-id'))!;

  await marker.press('ArrowUp');
  await expect(preview).toHaveAttribute('data-message-id', previous);
  await expect(page.getByTestId(SESSION_FEED_IDS.previewAuthor)).toHaveText(author(previous));
  await expect(page.getByTestId(SESSION_FEED_IDS.preview)).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/chat-marker-preview-mobile.png', fullPage: true });
  // The rail covers the feed's left edge, so click the feed itself on the right.
  const feedBox = (await feed.boundingBox())!;

  await feed.click({ position: { x: feedBox.width - 10, y: 10 } });
  // A touch screen previews on the first tap and goes to the message on the second.
  await marker.tap();
  await expect(preview).toHaveAttribute('data-message-id', target);
  await marker.tap();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': target })).toBeVisible();
});
