import { expect, type Locator, type Page } from '@playwright/test';
import { HistoryDirection } from '@protocol';
import { test, publishMessages } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { expectLoadedMessages } from './support/rail.js';
import { scrollSettled } from './support/scroll-settled.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { RAIL_HIT_SIZE } from '../../apps/mini-app/src/pages/session/config/message-navigation.js';

function conversation(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: 'rail-' + index,
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    text: 'Synthetic rail message ' + index + '. ' + 'Body text. '.repeat((index % 5) * 12 + 2),
    occurredAt: 1700000000000 + index,
  }));
}

async function open(page: Page) {
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();

  expect(bounds).not.toBeNull();

  return bounds!;
}

/** Band edges relative to the track, in pixels. */
async function bandEdges(page: Page) {
  const track = await box(page.getByTestId(SESSION_FEED_IDS.railTrack));
  const band = await box(page.getByTestId(SESSION_FEED_IDS.railBand));

  return { top: band.y - track.y, bottom: track.y + track.height - (band.y + band.height) };
}

test('the rail maps the whole loaded feed on its left and moves with the scrollbar', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await publishMessages(conversation(60));
  await open(page);
  const feed = page.getByTestId(SESSION_FEED_IDS.root);
  const markers = page.getByTestId(SESSION_FEED_IDS.marker);

  await expectLoadedMessages(page, 60);
  await expect.poll(() => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);

  const rail = await box(page.getByTestId(SESSION_FEED_IDS.rail));
  const bubble = await box(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'rail-59' }));

  expect(rail.x + rail.width).toBeLessThanOrEqual(bubble.x);
  await expect.poll(async () => (await bandEdges(page)).bottom).toBeLessThan(1);
  await page.screenshot({ path: 'artifacts/chat-rail-mobile.png', fullPage: true });

  await feed.evaluate((node) => node.scrollTo({ top: 0 }));
  await expect.poll(async () => (await bandEdges(page)).top).toBeLessThan(1);
  // The only page is loaded, so reaching the top proves there is no earlier history.
  await expect(page.getByTestId(SESSION_FEED_IDS.railCap)).toHaveCount(0);

  const track = await box(page.getByTestId(SESSION_FEED_IDS.railTrack));
  const tops = await markers.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  const ids = await markers.evaluateAll((nodes) => nodes.flatMap((node) => node.getAttribute('data-message-ids')!.split(' ')));

  expect(ids).toEqual(conversation(60).map((message) => message.id));
  expect(tops.length).toBeLessThanOrEqual(Math.floor(track.height / RAIL_HIT_SIZE));
  expect(tops.slice(1).every((top, index) => top - tops[index]! >= RAIL_HIT_SIZE - 0.5)).toBe(true);
  expect(tops[0]! - track.y).toBeLessThan(1);
  expect(track.y + track.height - (tops.at(-1)! + RAIL_HIT_SIZE)).toBeLessThan(RAIL_HIT_SIZE);

  await feed.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  await expect.poll(async () => (await bandEdges(page)).bottom).toBeLessThan(1);

  await markers.first().click();
  await expect.poll(() => feed.evaluate((node) => node.scrollTop)).toBeLessThan(2);
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'rail-0' })).toBeVisible();
  await expect(markers.first()).toHaveAttribute('aria-current', 'true');

  // A click on the free track centers the viewport on that point, like a native scrollbar track. Markers sit
  // above the track, so the click is dispatched to the track itself at its midpoint.
  const seek = page.getByTestId(SESSION_FEED_IDS.railSeek);
  const seekBox = await box(seek);
  const free = seekBox.height / 2;

  const before = await feed.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));

  await seek.dispatchEvent('click', { clientX: seekBox.x + seekBox.width / 2, clientY: seekBox.y + free });
  await scrollSettled(feed);
  const after = await feed.evaluate((node) => ({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  const band = await bandEdges(page);

  // Rows measured on arrival may grow the feed while it settles, so the target lies between both estimates.
  const target = (extent: number) => (free / seekBox.height) * extent - before.clientHeight / 2;
  const [low, high] = [target(before.scrollHeight), target(after.scrollHeight)].sort((a, b) => a - b);

  expect(after.scrollTop).toBeGreaterThanOrEqual(low! - 2);
  expect(after.scrollTop).toBeLessThanOrEqual(high! + 2);
  expect(Math.abs(band.top + (seekBox.height - band.top - band.bottom) / 2 - free)).toBeLessThan(RAIL_HIT_SIZE / 2);
});

test('a "more history" cap stands for unloaded pages and loads them', async ({ page }) => {
  await publishMessages(conversation(150));
  await open(page);
  const cap = byTestId(page, SESSION_FEED_IDS.railCap, { direction: HistoryDirection.Before });

  await expectLoadedMessages(page, 100);
  await expect(cap).toBeVisible();
  await expect(byTestId(page, SESSION_FEED_IDS.railCap, { direction: HistoryDirection.After })).toHaveCount(0);
  const track = await box(page.getByTestId(SESSION_FEED_IDS.railTrack));

  expect((await box(cap)).y + (await box(cap)).height).toBeLessThanOrEqual(track.y + 0.5);
  await cap.click();
  await expectLoadedMessages(page, 150);
  await expect(page.getByTestId(SESSION_FEED_IDS.marker).first()).toHaveAttribute('data-message-id', 'rail-0');
  await cap.click();
  await expect(cap).toHaveCount(0);
});
