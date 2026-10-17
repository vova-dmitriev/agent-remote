import { expect } from '@playwright/test';
import { test, publishMessages } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

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
  await expect(page.getByTestId(SESSION_FEED_IDS.marker)).toHaveCount(100);

  await expect(page.getByTestId(SESSION_FEED_IDS.preview)).toHaveCount(0);
  const marker = byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'preview-498' });
  const feed = page.getByTestId(SESSION_FEED_IDS.root);
  const position = await feed.evaluate((node) => node.scrollTop);

  await marker.hover();
  const preview = page.getByTestId(SESSION_FEED_IDS.preview);

  await expect(preview).toBeVisible();
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute('data-message-id', 'preview-498');
  await expect(page.getByTestId(SESSION_FEED_IDS.previewAuthor)).toHaveText('Claude');
  await expect(page.getByTestId(SESSION_FEED_IDS.previewText)).toContainText('Synthetic preview 498');
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
  await page.getByTestId(SESSION_FEED_IDS.frame).hover({ position: { x: 5, y: 5 } });
  await marker.hover();
  await expect(preview).toBeVisible();

  await preview.hover();
  await preview.click();
  await expect(preview).toBeVisible();
  expect(await feed.evaluate((node) => node.scrollTop)).toBe(position);
  await page.getByTestId(SESSION_FEED_IDS.frame).hover({ position: { x: 5, y: 5 } });
  await expect(preview).toHaveCount(0);
  await page.keyboard.press('Tab');
  await marker.focus();
  await expect(preview).toBeVisible();
  await marker.press('ArrowUp');
  await expect(preview).toHaveAttribute('data-message-id', 'preview-497');
  await expect(page.getByTestId(SESSION_FEED_IDS.previewAuthor)).toHaveText('Ты');
  await expect(page.getByTestId(SESSION_FEED_IDS.preview)).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/chat-marker-preview-mobile.png', fullPage: true });
  await page.getByTestId(SESSION_FEED_IDS.root).click({ position: { x: 10, y: 10 } });
  await marker.tap();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'preview-498' })).toBeVisible();
});
