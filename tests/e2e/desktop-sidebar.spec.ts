import { expect, test, type Page } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '../../apps/mini-app/src/widgets/session-sidebar/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '../../apps/mini-app/src/pages/sessions/config/test-ids.js';
import { DESKTOP_IDS } from '../../apps/mini-app/src/app/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SessionStatusTone } from '../../apps/mini-app/src/entities/session/config/session-values.js';
import { AppRoute, sessionRoute, subagentRoute } from '../../apps/mini-app/src/shared/lib/routes/app-route.js';
import { byTestId } from './support/testid.js';
import { installDesktopBridge } from './support/desktop-bridge.js';
import { sessionSnapshot } from './support/session-fixtures.js';

const deviceId = 'desktop-e2e-device';
const DESKTOP_PAGE = '/desktop.html';
const routeOf = (page: Page) => new URL(page.url()).hash;

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
  await expect.poll(() => routeOf(page)).toBe(sessionRoute('terminal-session'));

  await page.reload();
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toContainText('Synthetic sprint fixes');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(SESSION_PAGE_IDS.back)).toHaveCount(0);

  await page.getByTestId(SHELL_IDS.home).click();
  await expect(page.getByTestId(DESKTOP_IDS.placeholder)).toBeVisible();
  await expect.poll(() => routeOf(page)).toBe(AppRoute.Root);
});

test('keeps the route and selection in sync across the 960 px breakpoint', async ({ page }) => {
  await page.goto(DESKTOP_PAGE + sessionRoute('terminal-session'));
  await expect(byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' })).toHaveAttribute('aria-selected', 'true');

  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await expect.poll(() => routeOf(page)).toBe(AppRoute.Root);
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-cli-session' }).click();
  await expect.poll(() => routeOf(page)).toBe(sessionRoute('codex-cli-session'));

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toContainText('codex-cli');
  expect(routeOf(page)).toBe(sessionRoute('codex-cli-session'));
});

test('shows full titles with an ellipsis and the attention tone for a pending permission', async ({ page }) => {
  const codexTitle = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' }).getByTestId(SESSION_SIDEBAR_IDS.rowTitle);

  await expect(codexTitle).toHaveAttribute('title', 'codex-cli-thread');
  await expect(codexTitle).toHaveCSS('text-overflow', 'ellipsis');

  await expect(
    byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' }).getByTestId(SESSION_CARD_IDS.statusDot),
  ).toHaveAttribute('data-tone', SessionStatusTone.Attention);
});

test('follows back and forward through the session history', async ({ page }) => {
  const terminal = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' });
  const codex = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' });

  await terminal.click();
  await expect(terminal).toHaveAttribute('aria-selected', 'true');
  await codex.click();
  await expect(codex).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => routeOf(page)).toBe(sessionRoute('codex-cli-session'));

  await page.goBack();
  await expect(terminal).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toContainText('Synthetic sprint fixes');
  await page.goBack();
  await expect(page.getByTestId(DESKTOP_IDS.placeholder)).toBeVisible();
  await page.goForward();
  await expect(terminal).toHaveAttribute('aria-selected', 'true');
});

test('opens a deep link, keeps the parent selected for a subagent route and replaces an unknown session', async ({ page }) => {
  const terminal = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' });

  await page.goto(DESKTOP_PAGE + subagentRoute('terminal-session', 'synthetic-agent'));
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toContainText('Synthetic sprint fixes');
  await expect(terminal).toHaveAttribute('aria-selected', 'true');
  expect(routeOf(page)).toBe(subagentRoute('terminal-session', 'synthetic-agent'));

  await page.goto('about:blank');
  await page.goto(DESKTOP_PAGE + sessionRoute('missing-session'));
  await expect(page.getByTestId(DESKTOP_IDS.placeholder)).toBeVisible();
  await expect.poll(() => routeOf(page)).toBe(AppRoute.Root);
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
  await search.fill('zz-no-synthetic-match');
  await page.getByTestId(SESSION_SIDEBAR_IDS.emptyClear).click();
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
