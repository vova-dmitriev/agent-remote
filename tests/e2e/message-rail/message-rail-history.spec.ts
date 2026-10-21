import { expect, type Page } from '@playwright/test';
import { HistoryDirection } from '@protocol';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { box, expectLoadedMessages, jumpNear, railConversation } from '../support/ui/rail.js';
import { scrollSettled } from '../support/ui/scroll-settled.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS, SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { RAIL_HIT_SIZE } from '@/pages/session/config/message-navigation.js';

const earlier = (page: Page) => byTestId(page, SESSION_FEED_IDS.railCap, { direction: HistoryDirection.Before });
const later = (page: Page) => byTestId(page, SESSION_FEED_IDS.railCap, { direction: HistoryDirection.After });

async function open(page: Page, sessionId = 'terminal-session') {
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': sessionId }).click();
}

test('a "more history" cap sits beside the full-height track and loads earlier pages', async ({ page }) => {
  await publishMessages(railConversation(150));
  await identity(page, '801', 'en');
  await page.goto('/');
  await open(page);

  await expectLoadedMessages(page, 100);
  await expect(earlier(page)).toBeVisible();
  await expect(later(page)).toHaveCount(0);
  const track = await box(page.getByTestId(SESSION_FEED_IDS.railTrack));
  const feed = await box(page.getByTestId(SESSION_FEED_IDS.root));
  const cap = await box(earlier(page));

  expect(Math.abs(track.y - feed.y)).toBeLessThan(0.5);
  expect(Math.abs(track.height - feed.height)).toBeLessThan(0.5);
  expect(cap.x + cap.width).toBeLessThanOrEqual(track.x + 0.5);
  expect(cap.height).toBeGreaterThanOrEqual(RAIL_HIT_SIZE);

  await earlier(page).click();
  await expectLoadedMessages(page, 150);
  await expect(page.getByTestId(SESSION_FEED_IDS.marker).first()).toHaveAttribute('data-message-id', 'rail-0');
  await earlier(page).click();
  await expect(earlier(page)).toHaveCount(0);
});

test('loading an earlier page from the cap keeps the reading position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await publishMessages(railConversation(150));
  await identity(page, '801', 'en');
  await page.goto('/');
  await open(page);
  const feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expectLoadedMessages(page, 100);
  const target = await jumpNear(page, 'rail-100');
  const row = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': target });

  await scrollSettled(feed);
  const before = await row.evaluate((node) => node.getBoundingClientRect().top);

  await earlier(page).click();
  await expectLoadedMessages(page, 150);
  await scrollSettled(feed);
  expect(Math.abs((await row.evaluate((node) => node.getBoundingClientRect().top)) - before)).toBeLessThan(3);
});

test('with history beyond both ends, a later page loads while an earlier one is in flight', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.setViewportSize({ width: 390, height: 1400 });

  const short = Array.from({ length: 330 }, (_, index) => ({
    id: 'short-' + index,
    // Every other message is the owner's: the rail marks those.
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    text: 'Short ' + index,
    occurredAt: 1700000000000 + index,
  }));

  await publishMessages(short, 'codex-desktop-session');
  await identity(page, '801', 'en');
  await page.goto('/');
  await open(page, 'codex-desktop-session');
  await expectLoadedMessages(page, 100);
  await jumpNear(page, 'short-240');
  await scrollSettled(page.getByTestId(SESSION_FEED_IDS.root));

  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/reading-position') && response.request().method() === 'PUT' && response.ok(),
  );

  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await saved;
  // Newer messages arrive while the session is closed, so the restored window ends before the session's last message.
  await publishMessages(short.slice(230).map((message, index) => ({ ...message, id: 'later-' + index, occurredAt: message.occurredAt + 100 })), 'codex-desktop-session');
  await page.reload();
  await open(page, 'codex-desktop-session');
  await expect(earlier(page)).toBeVisible();
  await expect(later(page)).toBeVisible();
  await page.screenshot({ path: 'artifacts/chat-rail-caps-mobile.png' });

  // Each direction pages on its own: a held earlier page never blocks the later one.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));

  await page.route('**/events?before=**', async (route) => {
    await held;
    await route.continue();
  });

  const earlierPage = page.waitForResponse((response) => response.url().includes('/events?before='));
  const laterPage = page.waitForResponse((response) => response.url().includes('/events?after='));

  await earlier(page).click();
  await later(page).click();
  expect((await laterPage).ok()).toBe(true);
  release();
  expect((await earlierPage).ok()).toBe(true);
});
