import { expect } from '@playwright/test';
import { test, publishMessages } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { expectLoadedMessages } from './support/rail.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

test('animates explicit navigation and keeps the clicked marker preview closed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await publishMessages(Array.from({ length: 100 }, (_, index) => ({ id: 'smooth-' + index, role: 'assistant' as const, text: 'Synthetic row ' + index + '. '.repeat(20), occurredAt: 1700000000000 + index })));
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expectLoadedMessages(page, 100);
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'smooth-99' })).toBeVisible();
  await expect.poll(() => feed.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(5);
  const initial = await feed.evaluate(node => node.scrollTop);
  const first = page.getByTestId(SESSION_FEED_IDS.marker).first();

  await expect(first).toHaveAttribute('data-message-id', 'smooth-0');

  await first.hover();
  await expect(page.getByTestId(SESSION_FEED_IDS.preview)).toBeVisible();
  await first.click();
  await expect(page.getByTestId(SESSION_FEED_IDS.preview)).toHaveCount(0);
  await expect.poll(() => feed.evaluate(node => node.scrollTop)).toBeLessThan(initial);
  expect(await feed.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => feed.evaluate(node => node.scrollTop)).toBeLessThan(5);
  await expect(page.getByTestId(SESSION_FEED_IDS.preview)).toHaveCount(0);
  await page.getByTestId(SESSION_FEED_IDS.bottom).click();
  const remaining = await feed.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop);

  expect(remaining).toBeGreaterThan(0);
  await expect.poll(() => feed.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(5);
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'smooth-99' })).toBeVisible();
});

test('reduced motion still reaches the target and dismisses a clicked preview', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await publishMessages(Array.from({ length: 35 }, (_, index) => ({ id: 'reduced-' + index, role: 'assistant' as const, text: 'Synthetic row ' + index, occurredAt: 1700000000000 + index })));
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const first = page.getByTestId(SESSION_FEED_IDS.marker).first();

  await expect(first).toHaveAttribute('data-message-id', 'reduced-0');

  await first.hover();
  await first.click();
  await expect(page.getByTestId(SESSION_FEED_IDS.preview)).toHaveCount(0);
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'reduced-0' })).toBeVisible();
});
