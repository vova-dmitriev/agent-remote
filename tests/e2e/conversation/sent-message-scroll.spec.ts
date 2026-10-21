import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { conversation } from '../support/fixtures/conversation-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { expectLoadedMessages } from '../support/ui/rail.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';

test('a message the owner sent brings the feed down to it, even while reading above', async ({ page }) => {
  await publishMessages(conversation);
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  const feed = page.getByTestId(SESSION_FEED_IDS.root);
  const fromBottom = () => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);

  await expectLoadedMessages(page, 35);
  await page.getByTestId(SESSION_FEED_IDS.marker).first().click();
  await expect.poll(() => feed.evaluate((node) => node.scrollTop)).toBeLessThan(5);

  await publishMessages([{ id: 'sent-by-owner', role: 'user', text: 'Synthetic question from the owner', occurredAt: Date.now() }]);

  await expectLoadedMessages(page, 36);
  await expect.poll(fromBottom).toBeLessThan(5);
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'sent-by-owner' })).toBeInViewport();
});
