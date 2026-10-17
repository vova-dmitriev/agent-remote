import { expect } from '@playwright/test';
import { test, publishMessages } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

test('Codex preserves a line inside a long message after a smooth rail jump and return from the list', async ({
  page,
}) => {
  await publishMessages(
    Array.from({ length: 500 }, (_, i) => ({
      id: 'codex-read-' + i,
      role: 'assistant' as const,
      text: ('Paragraph ' + i + '. Synthetic conversation.\n\n').repeat(i === 425 ? 180 : 3),
      occurredAt: 1700000000000 + i,
    })),
    'codex-desktop-session',
  );

  await identity(page, '801', 'en');
  await page.goto('/');
  const open = () => byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-desktop-session' }).click();

  await open();
  await byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'codex-read-425' }).click();
  const row = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': 'codex-read-425' });
  const feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expect
    .poll(async () =>
      Math.abs(
        (await row.evaluate((node) => node.getBoundingClientRect().top)) -
          (await feed.evaluate((node) => node.getBoundingClientRect().top)) -
          22,
      ),
    )
    .toBeLessThan(3);

  await feed.hover();
  await page.mouse.wheel(0, 5435);

  await expect
    .poll(async () => await row.evaluate((node) => node.getBoundingClientRect().top))
    .toBeLessThan(0);

  const position = await row.evaluate((node) => node.getBoundingClientRect().top);

  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await open();
  await expect(row).toBeAttached();

  await expect
    .poll(async () => Math.abs((await row.evaluate((node) => node.getBoundingClientRect().top)) - position))
    .toBeLessThan(3);

  await expect(byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'codex-read-425' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  const marker = byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'codex-read-425' });
  const rail = page.getByTestId(SESSION_FEED_IDS.rail);

  await expect
    .poll(async () => {
      const selected = await marker.boundingBox();
      const viewport = await rail.boundingBox();

      return selected && viewport
        ? Math.min(selected.y - viewport.y, viewport.y + viewport.height - selected.y - selected.height)
        : 0;
    })
    .toBeGreaterThanOrEqual(24);

  await marker.press('ArrowDown');
  await expect(byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'codex-read-426' })).toBeFocused();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'codex-read-426' })).toBeVisible();
});

test('a fresh Mini App restores the server bookmark without browser storage', async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await publishMessages(
    Array.from({ length: 180 }, (_, i) => ({
      id: 'server-read-' + i,
      role: 'assistant' as const,
      text: ('Synthetic line ' + i + '\n\n').repeat(8),
      occurredAt: 1700000000000 + i,
    })),
    'codex-desktop-session',
  );

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-desktop-session' }).click();
  await byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'server-read-120' }).click();

  const row = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': 'server-read-120' }),
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
    const restored = byTestId(reopened, SESSION_FEED_IDS.virtualRow, { 'message-id': 'server-read-120' });

    await expect(restored).toBeAttached();

    await expect
      .poll(async () =>
        Math.abs((await restored.evaluate((node) => node.getBoundingClientRect().top)) - position),
      )
      .toBeLessThan(3);

    await expect(
      byTestId(reopened, SESSION_FEED_IDS.marker, { 'message-id': 'server-read-120' }),
    ).toHaveAttribute('aria-current', 'true');
  } finally {
    await context.close();
  }
});
