import { expect, type Page } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { bandEdges, box, expectLoadedMessages, focusedTestId, railConversation } from '../support/ui/rail.js';
import { scrollSettled } from '../support/ui/scroll-settled.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { RAIL_HIT_SIZE } from '@/pages/session/config/message-navigation.js';

const conversation = (count: number) => railConversation(count);

async function open(page: Page) {
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
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

  const fullTrack = await box(page.getByTestId(SESSION_FEED_IDS.railTrack));
  const scroller = await box(feed);

  expect(rail.x + rail.width).toBeLessThanOrEqual(bubble.x);
  // The track spans the scroll container's full height, exactly like the native scrollbar.
  expect(Math.abs(fullTrack.y - scroller.y)).toBeLessThan(0.5);
  expect(Math.abs(fullTrack.height - scroller.height)).toBeLessThan(0.5);
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

  // A click on the point track centers the viewport on that point, like a native scrollbar track. Markers sit
  // above the track, so the click is dispatched to the track itself at its midpoint.
  const seek = page.getByTestId(SESSION_FEED_IDS.railSeek);
  const seekBox = await box(seek);
  const point = seekBox.height / 2;

  const before = await feed.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));

  await seek.dispatchEvent('click', { clientX: seekBox.x + seekBox.width / 2, clientY: seekBox.y + point });
  await scrollSettled(feed);
  const after = await feed.evaluate((node) => ({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  const band = await bandEdges(page);

  // Rows measured on arrival may grow the feed while it settles, so the target lies between both estimates.
  const target = (extent: number) => (point / seekBox.height) * extent - before.clientHeight / 2;
  const [low, high] = [target(before.scrollHeight), target(after.scrollHeight)].sort((a, b) => a - b);

  expect(after.scrollTop).toBeGreaterThanOrEqual(low! - 2);
  expect(after.scrollTop).toBeLessThanOrEqual(high! + 2);
  expect(Math.abs(band.top + (seekBox.height - band.top - band.bottom) / 2 - point)).toBeLessThan(RAIL_HIT_SIZE / 2);
});

test('a middle marker sits where its row sits in the scrollable content', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await publishMessages(conversation(60));
  await open(page);
  const markers = page.getByTestId(SESSION_FEED_IDS.marker);
  const feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expectLoadedMessages(page, 60);
  await markers.nth(Math.floor((await markers.count()) / 2)).click();
  await scrollSettled(feed);

  // Every marker whose first message is rendered: tick y on the track vs row offset / scrollHeight × track height.
  await expect
    .poll(async () => {
      const track = await box(page.getByTestId(SESSION_FEED_IDS.railTrack));
      const scrollHeight = await feed.evaluate((node) => node.scrollHeight);

      const rows = new Map(
        await page
          .getByTestId(SESSION_FEED_IDS.virtualRow)
          .evaluateAll((nodes) =>
            nodes.map((node) => [node.dataset.messageId!, node.getBoundingClientRect().top - node.parentElement!.getBoundingClientRect().top] as const),
          ),
      );

      const ticks = await markers.evaluateAll((nodes) =>
        nodes.map((node) => {
          const tick = node.firstElementChild!.getBoundingClientRect();

          return [node.dataset.messageId!, tick.top + tick.height / 2] as const;
        }),
      );

      const offsets = ticks
        .filter(([id]) => rows.has(id))
        .map(([id, y]) => Math.abs(y - track.y - (rows.get(id)! / scrollHeight) * track.height));

      return offsets.length > 1 && Math.max(...offsets) < 1;
    })
    .toBe(true);
});

test('keyboard focus stays on the rail while jumps into unmeasured rows regroup its markers', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await publishMessages(conversation(100));
  await open(page);
  const markers = page.getByTestId(SESSION_FEED_IDS.marker);

  await expectLoadedMessages(page, 100);
  await markers.last().focus();
  await page.keyboard.press('Home');
  await expect.poll(() => focusedTestId(page)).toBe(SESSION_FEED_IDS.marker);

  for (let press = 0; press < 5; press++) {
    await page.keyboard.press('ArrowDown');
    await scrollSettled(page.getByTestId(SESSION_FEED_IDS.root));
    await expect.poll(() => focusedTestId(page)).toBe(SESSION_FEED_IDS.marker);
  }
});
