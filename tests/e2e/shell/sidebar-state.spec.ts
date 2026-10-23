import { expect, test, type Page } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SidebarGroup } from '@/widgets/session-sidebar/config/values.js';
import { DESKTOP_IDS } from '@/app/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const open = async (page: Page, snapshot = sessionSnapshot('desktop-e2e-device'), history: unknown[] = []) => {
  await installDesktopBridge(page, 'desktop-e2e-device', snapshot, {}, history);
  await page.goto('/desktop.html');
};

test('pins a session to the top of the sidebar without opening it, and unpins it', async ({ page }) => {
  await open(page);
  const row = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' });
  const pin = row.getByTestId(SESSION_SIDEBAR_IDS.rowPin);
  const groups = page.getByTestId(SESSION_SIDEBAR_IDS.group);
  const pinnedGroup = byTestId(page, SESSION_SIDEBAR_IDS.group, { group: SidebarGroup.Pinned });

  await expect(pinnedGroup).toHaveCount(0);
  await row.hover();
  await pin.click();

  await expect(groups.first()).toHaveAttribute('data-group', SidebarGroup.Pinned);
  await expect(pinnedGroup.getByTestId(SESSION_SIDEBAR_IDS.row)).toHaveAttribute('data-session-id', 'terminal-session');
  await expect(pin).toHaveAttribute('data-pinned', 'true');
  await expect(page.getByTestId(DESKTOP_IDS.placeholder)).toBeVisible();

  // A device that refuses the change leaves the pin as it was and says so.
  await page.evaluate(() => ((window as unknown as { pinRefused: boolean }).pinRefused = true));
  await pin.click();
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.pinError)).toBeVisible();
  await expect(pin).toHaveAttribute('data-pinned', 'true');

  await page.evaluate(() => ((window as unknown as { pinRefused: boolean }).pinRefused = false));
  await pin.click();
  await expect(pinnedGroup).toHaveCount(0);
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.pinError)).toHaveCount(0);
  await expect(pin).toHaveAttribute('data-pinned', 'false');
});

test('pins the row under the keyboard cursor with P, while P in the search field only types', async ({ page }) => {
  await open(page);
  const search = page.getByTestId(SESSION_SIDEBAR_IDS.search);
  const list = page.getByTestId(SESSION_SIDEBAR_IDS.list);
  const pinnedGroup = byTestId(page, SESSION_SIDEBAR_IDS.group, { group: SidebarGroup.Pinned });

  await search.fill('p');
  await expect(pinnedGroup).toHaveCount(0);
  await search.fill('');

  await list.focus();
  await page.keyboard.press('ArrowDown');
  const id = (await byTestId(page, SESSION_SIDEBAR_IDS.row, { cursor: 'true' }).getAttribute('data-session-id'))!;

  await page.keyboard.press('p');
  await expect(pinnedGroup.getByTestId(SESSION_SIDEBAR_IDS.row)).toHaveAttribute('data-session-id', id);
});


test('shows a session’s unread replies in the sidebar and clears them once the session is read', async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');

  snapshot.sessions.find((item) => item.id === 'chat-session')!.unread = 3;

  const reply = { id: 'synthetic-reply', role: 'assistant', text: 'Synthetic reply', occurredAt: 1_000 };

  await open(page, snapshot, [
    { version: 1, deviceId: 'desktop-e2e-device', streamId: 'unread-e2e', seq: 1, eventId: 'unread-1', sessionId: 'chat-session', occurredAt: 1_000, type: 'message', payload: reply },
  ]);

  const row = (id: string) => byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': id });

  await expect(row('chat-session').getByTestId(SESSION_CARD_IDS.unread)).toHaveText('3Unread replies: 3');
  await expect(row('terminal-session').getByTestId(SESSION_CARD_IDS.unread)).toHaveCount(0);

  await row('chat-session').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { readMarks?: string[] }).readMarks)).toEqual(['chat-session']);
  await row('terminal-session').click();
  // The read mark reached the device, whose next snapshot has no count for the session.
  await expect(row('chat-session').getByTestId(SESSION_CARD_IDS.unread)).toHaveCount(0);
});
