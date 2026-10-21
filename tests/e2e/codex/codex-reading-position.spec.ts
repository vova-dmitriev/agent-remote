import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { jumpNear, railMarker } from '../support/ui/rail.js';
import { scrollSettled } from '../support/ui/scroll-settled.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';

test('Codex preserves a line inside a long message after a smooth rail jump and return from the list', async ({
  page,
}) => {
  await publishMessages(
    Array.from({ length: 500 }, (_, i) => ({
      id: 'codex-read-' + i,
      // The odd messages are the owner's, which the rail marks: the long message 425 among them.
      role: i % 2 ? ('user' as const) : ('assistant' as const),
      text: ('Paragraph ' + i + '. Synthetic conversation.\n\n').repeat(i === 425 ? 180 : 3),
      occurredAt: 1700000000000 + i,
    })),
    'codex-desktop-session',
  );

  await identity(page, '801', 'en');
  await page.goto('/');
  const open = () => byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-desktop-session' }).click();

  await open();
  // The long message shares a rail target with short neighbours; the jump lands on that target's first message.
  const target = await jumpNear(page, 'codex-read-425');
  const landed = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': target });
  const row = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': 'codex-read-425' });
  const feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expect
    .poll(async () =>
      Math.abs(
        (await landed.evaluate((node) => node.getBoundingClientRect().top)) -
          (await feed.evaluate((node) => node.getBoundingClientRect().top)) -
          22,
      ),
    )
    .toBeLessThan(3);

  await feed.hover();

  // Wheel into the long message, whose start is somewhere below the landed target.
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 900);

      return row.evaluate((node) => node.getBoundingClientRect().top);
    })
    .toBeLessThan(0);

  await scrollSettled(feed);
  const position = await row.evaluate((node) => node.getBoundingClientRect().top);

  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await open();
  await expect(row).toBeAttached();

  await expect
    .poll(async () => Math.abs((await row.evaluate((node) => node.getBoundingClientRect().top)) - position))
    .toBeLessThan(3);

  const marker = railMarker(page, 'codex-read-425');
  const markers = page.getByTestId(SESSION_FEED_IDS.marker);

  await expect(marker).toHaveAttribute('aria-current', 'true');
  const index = await markers.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('aria-current') === 'true'));
  const next = markers.nth(index + 1);
  const nextId = (await next.getAttribute('data-message-id'))!;

  await marker.press('ArrowDown');
  await expect(next).toBeFocused();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': nextId })).toBeVisible();
});

test('a fresh Mini App restores the server bookmark without browser storage', async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await publishMessages(
    Array.from({ length: 180 }, (_, i) => ({
      id: 'server-read-' + i,
      role: i % 2 ? ('user' as const) : ('assistant' as const),
      text: ('Synthetic line ' + i + '\n\n').repeat(8),
      occurredAt: 1700000000000 + i,
    })),
    'codex-desktop-session',
  );

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-desktop-session' }).click();
  const target = await jumpNear(page, 'server-read-120');

  const row = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': target }),
    feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expect(row).toBeVisible();

  await feed.evaluate((node) => {
    node.scrollTop += 83;
  });

  const position = await row.evaluate((node) => node.getBoundingClientRect().top);

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/sessions/codex-desktop-session/reading-position') &&
      response.request().method() === 'PUT' &&
      response.ok(),
  );

  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await saved;

  await publishMessages(
    Array.from({ length: 150 }, (_, i) => ({
      id: 'server-read-' + (i + 180),
      role: 'assistant' as const,
      text: 'Arrived while closed ' + i,
      occurredAt: 1700000000180 + i,
    })),
    'codex-desktop-session',
  );

  const context = await browser.newContext({ viewport: page.viewportSize()!, reducedMotion: 'reduce' });

  try {
    const reopened = await context.newPage();

    await reopened.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage blocked', 'SecurityError');
        },
      });
    });

    await identity(reopened, '801', 'en');
    await reopened.goto('/');
    await byTestId(reopened, SESSION_CARD_IDS.root, { 'session-id': 'codex-desktop-session' }).click();
    const restored = byTestId(reopened, SESSION_FEED_IDS.virtualRow, { 'message-id': target });

    await expect(restored).toBeAttached();

    await expect
      .poll(async () =>
        Math.abs((await restored.evaluate((node) => node.getBoundingClientRect().top)) - position),
      )
      .toBeLessThan(3);

    await expect(railMarker(reopened, target)).toHaveAttribute('aria-current', 'true');
  } finally {
    await context.close();
  }
});
