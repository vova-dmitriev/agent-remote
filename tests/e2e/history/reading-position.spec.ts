import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { jumpNear, railMarker } from '../support/ui/rail.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';

test('restores the exact reading line after back, new messages and a Mini App reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await publishMessages(
    Array.from({ length: 80 }, (_, index) => ({
      id: 'read-' + index,
      role: 'assistant' as const,
      text:
        'Synthetic reading message ' + index + '\n\n' + ('Paragraph ' + index + '. ').repeat((index % 4) + 1),
      occurredAt: 1700000000000 + index,
    })),
  );

  await identity(page, '801');
  await page.goto('/');
  const open = () => byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  await open();
  const target = await jumpNear(page, 'read-25');
  const message = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': target });

  await expect(message).toBeVisible();

  await page.getByTestId(SESSION_FEED_IDS.root).evaluate((node) => {
    node.scrollTop += 37;
  });

  const position = await message.evaluate((node) => node.getBoundingClientRect().top);

  await page.getByTestId(SESSION_PAGE_IDS.back).click();

  await publishMessages([
    { id: 'read-80', role: 'assistant', text: 'Arrived while closed', occurredAt: 1700000000080 },
  ]);

  await open();
  await expect(message).toBeVisible();

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(3);

  await expect(railMarker(page, target)).toHaveAttribute(
    'aria-current',
    'true',
  );

  await page.reload();
  await open();
  await expect(message).toBeVisible();

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(3);

  await expect(railMarker(page, target)).toHaveAttribute(
    'aria-current',
    'true',
  );

  await publishMessages([
    { id: 'read-81', role: 'assistant', text: 'Arrived while reading', occurredAt: 1700000000081 },
  ]);

  await expect
    .poll(async () =>
      Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - position),
    )
    .toBeLessThan(3);

  await expect(railMarker(page, target)).toHaveAttribute(
    'aria-current',
    'true',
  );

  await page.getByTestId(SESSION_FEED_IDS.bottom).click();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'read-81' })).toBeVisible();
});

for (const sessionId of ['terminal-session', 'codex-desktop-session']) {
  test(`${sessionId} restores the wheel-scrolled marker after list return and reload`, async ({ page }) => {
    await publishMessages(
      Array.from({ length: 100 }, (_, index) => ({
        id: 'wheel-read-' + index,
        role: 'assistant' as const,
        text: ('Synthetic paragraph ' + index + '.\n\n').repeat((index % 7) + 6),
        occurredAt: 1700000000000 + index,
      })),
      sessionId,
    );

    await identity(page, '801');
    await page.goto('/');
    const open = () => byTestId(page, SESSION_CARD_IDS.root, { 'session-id': sessionId }).click();

    await open();
    const feed = page.getByTestId(SESSION_FEED_IDS.root);

    await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'wheel-read-99' })).toBeVisible();
    await feed.hover();
    await page.mouse.wheel(0, -3435);

    await expect
      .poll(() => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeGreaterThan(3000);

    const top = await feed.evaluate((node) => node.getBoundingClientRect().top + 22);

    const id = await page
      .getByTestId(SESSION_FEED_IDS.virtualRow)
      .evaluateAll(
        (nodes, line) =>
          nodes.find((node) => node.getBoundingClientRect().bottom > line)?.getAttribute('data-message-id'),
        top,
      );

    expect(id).toBeTruthy();
    expect(id).not.toBe('wheel-read-99');
    const row = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': id! });
    const marker = railMarker(page, id!);
    const position = await row.evaluate((node) => node.getBoundingClientRect().top);

    await expect(marker).toHaveAttribute('aria-current', 'true');
    await page.getByTestId(SESSION_PAGE_IDS.back).click();
    await open();
    await expect(row).toBeAttached();

    await expect
      .poll(async () => Math.abs((await row.evaluate((node) => node.getBoundingClientRect().top)) - position))
      .toBeLessThan(3);

    await expect(marker).toHaveAttribute('aria-current', 'true');

    await expect(
      railMarker(page, 'wheel-read-99'),
    ).not.toHaveAttribute('aria-current', 'true');

    await page.reload();
    await open();
    await expect(row).toBeAttached();

    await expect
      .poll(async () => Math.abs((await row.evaluate((node) => node.getBoundingClientRect().top)) - position))
      .toBeLessThan(3);

    await expect(marker).toHaveAttribute('aria-current', 'true');

    await expect(
      railMarker(page, 'wheel-read-99'),
    ).not.toHaveAttribute('aria-current', 'true');
  });
}
