import { expect, test } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { SidebarGroup } from '@/widgets/session-sidebar/config/values.js';
import { DESKTOP_IDS } from '@/app/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test.beforeEach(async ({ page }) => {
  await installDesktopBridge(page, 'desktop-e2e-device', sessionSnapshot('desktop-e2e-device'));
  await page.goto('/desktop.html');
});

test('pins a session to the top of the sidebar without opening it, and unpins it', async ({ page }) => {
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
