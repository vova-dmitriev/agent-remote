import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { expectLoadedMessages, expectSettledRail, railMarker } from '../support/ui/rail.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';

test('a tap on a rail tick previews its message first; a tap on the preview goes there', async ({ page }) => {
  await publishMessages(
    Array.from({ length: 60 }, (_, index) => ({
      id: 'touch-' + index,
      role: index % 2 ? ('user' as const) : ('assistant' as const),
      text: 'Synthetic touch message ' + index + '. ' + 'A readable line. '.repeat(12),
      occurredAt: 1700000000000 + index,
    })),
  );

  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expectLoadedMessages(page, 60);
  await expectSettledRail(page);

  const feed = page.getByTestId(SESSION_FEED_IDS.root);
  const preview = page.getByTestId(SESSION_FEED_IDS.preview);
  // A marker may cover several messages; it previews and goes to its first.
  const marker = railMarker(page, 'touch-2');
  const first = (await marker.getAttribute('data-message-id'))!;
  const target = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': first });
  const before = await feed.evaluate((node) => node.scrollTop);

  await marker.tap();

  // The first tap only shows what is there: the feed stays where it was.
  await expect(preview).toHaveAttribute('data-message-id', first);
  expect(await feed.evaluate((node) => node.scrollTop)).toBe(before);
  await expect(target).not.toBeInViewport();

  await page.getByTestId(SESSION_FEED_IDS.previewOpen).tap();
  await expect(target).toBeInViewport();
  await expect(preview).toHaveCount(0);

  // A tap elsewhere closes a preview without going anywhere.
  const other = railMarker(page, 'touch-40');

  await other.tap();
  await expect(preview).toHaveAttribute('data-message-id', (await other.getAttribute('data-message-id'))!);
  await target.tap();
  await expect(preview).toHaveCount(0);
});
