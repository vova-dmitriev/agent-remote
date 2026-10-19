import { expect, test } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '../../apps/mini-app/src/widgets/session-sidebar/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '../../apps/mini-app/src/pages/sessions/config/test-ids.js';
import { DESKTOP_IDS } from '../../apps/mini-app/src/app/config/test-ids.js';
import { byTestId } from './support/testid.js';
import { installDesktopBridge } from './support/desktop-bridge.js';
import { sessionSnapshot } from './support/session-fixtures.js';

const deviceId = 'desktop-e2e-device';
const DESKTOP_PAGE = '/desktop.html';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test.beforeEach(async ({ page }) => {
  await installDesktopBridge(page, deviceId, sessionSnapshot(deviceId));
  await page.goto(DESKTOP_PAGE);
});

test('shows the session sidebar with a placeholder pane and opens a row in the main pane', async ({ page }) => {
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.root)).toBeVisible();
  await expect(page.getByTestId(DESKTOP_IDS.placeholder)).toBeVisible();
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.row)).toHaveCount(4);

  const row = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' });

  await row.click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toContainText('Synthetic sprint fixes');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  // Electron trusts bridge IPC only from the exact bundle URL, so selection must never rewrite it.
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.root)).toBeVisible();

  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await expect(page.getByTestId(DESKTOP_IDS.placeholder)).toBeVisible();
});

test('opens the new-session pane from the sidebar and returns to the placeholder from the brand', async ({ page }) => {
  await page.getByTestId(SESSION_SIDEBAR_IDS.newSession).click();
  await expect(page.getByTestId(DESKTOP_IDS.newSession)).toBeVisible();
  await page.getByTestId(SHELL_IDS.home).click();
  await expect(page.getByTestId(DESKTOP_IDS.placeholder)).toBeVisible();
});

test('filters by title, project, model or provider and clears the search with Escape', async ({ page }) => {
  const search = page.getByTestId(SESSION_SIDEBAR_IDS.search);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(search).toBeFocused();
  await search.fill('codex');
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.row)).toHaveCount(2);
  await search.fill('sprint');
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.row)).toHaveCount(1);
  await search.fill('zz-no-synthetic-match');
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.empty)).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.row)).toHaveCount(4);
});

test('opens the cursor row with the keyboard', async ({ page }) => {
  const search = page.getByTestId(SESSION_SIDEBAR_IDS.search);

  await search.fill('sprint');
  await search.press('Enter');
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toContainText('Synthetic sprint fixes');
});

test('remembers the collapsed rail and keeps the list/page navigation below 960 px', async ({ page }) => {
  await page.getByTestId(SHELL_IDS.sidebarToggle).click();
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.rail)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.rail)).toBeVisible();
  await page.getByTestId(SESSION_SIDEBAR_IDS.railSearch).click();
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.search)).toBeFocused();

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.root)).toBeVisible();
});
