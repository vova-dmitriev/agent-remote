import { expect, test } from '@playwright/test';
import { SessionRemoval } from '@protocol';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { REMOVE_SESSION_IDS } from '@/features/remove-session/config/test-ids.js';
import { DESKTOP_IDS } from '@/app/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test.beforeEach(async ({ page }) => {
  await installDesktopBridge(page, 'desktop-e2e-device', sessionSnapshot('desktop-e2e-device'));
  await page.goto('/desktop.html');
});

test('archives a Codex session from its menu: it leaves the list and the page closes', async ({ page }) => {
  const row = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' });

  await row.click();
  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await expect(page.getByTestId(REMOVE_SESSION_IDS.hide)).toBeVisible();
  await expect(page.getByTestId(REMOVE_SESSION_IDS.end)).toBeVisible();
  await page.getByTestId(REMOVE_SESSION_IDS.archive).click();

  await expect(row).toHaveCount(0);
  await expect(page.getByTestId(DESKTOP_IDS.placeholder)).toBeVisible();

  expect(await page.evaluate(() => (window as unknown as { removals: unknown[] }).removals)).toEqual([
    { sessionId: 'codex-cli-session', mode: SessionRemoval.Archive },
  ]);
});

test('offers no Codex archive for a Claude session, whose archive is hiding', async ({ page }) => {
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();

  await expect(page.getByTestId(REMOVE_SESSION_IDS.hide)).toBeVisible();
  await expect(page.getByTestId(REMOVE_SESSION_IDS.archive)).toHaveCount(0);
});
