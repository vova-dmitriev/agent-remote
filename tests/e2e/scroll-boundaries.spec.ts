import { expect } from '@playwright/test';
import { test, publishMessages } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { expectActiveMessage, expectLoadedMessages, railMarker } from './support/rail.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

test('a marker in a short conversation does not offer an unnecessary bottom button', async ({ page }) => {
  await publishMessages([
    { id: 'short-message', role: 'assistant', text: 'A short synthetic answer.', occurredAt: Date.now() },
  ]);

  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.message)).toBeVisible();
  await page.getByTestId(SESSION_FEED_IDS.marker).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.bottom)).toHaveCount(0);
});

for (const ending of ['Short final answer.', '']) {
  test(`bottom selects the final marker for a ${ending ? 'short' : 'blank'} final message`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await publishMessages([
      ...Array.from({ length: 20 }, (_, index) => ({
        id: 'bottom-' + index,
        role: 'assistant' as const,
        text: ('Synthetic paragraph ' + index + '. ').repeat(60),
        occurredAt: 1700000000000 + index,
      })),
      { id: 'bottom-final', role: 'assistant', text: ending, occurredAt: 1700000000020 },
    ]);

    await identity(page, '801');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
    const feed = page.getByTestId(SESSION_FEED_IDS.root);

    await expectLoadedMessages(page, 21);
    await expect.poll(() => feed.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(1);
    await expectActiveMessage(page, 'bottom-final');
    await feed.hover();
    await page.mouse.wheel(0, -20);
    await expect.poll(() => feed.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(1);
    await expectActiveMessage(page, 'bottom-19');
    await expect(page.getByTestId(SESSION_FEED_IDS.bottom)).toHaveCount(0);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => feed.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(80);
    await expectActiveMessage(page, 'bottom-19');
    await page.getByTestId(SESSION_FEED_IDS.bottom).click();
    await expectActiveMessage(page, 'bottom-final');
    await expect(railMarker(page, 'bottom-final')).toHaveAttribute('aria-current', 'true');
  });
}
