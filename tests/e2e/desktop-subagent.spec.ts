import { expect, test, type Page } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '../../apps/mini-app/src/widgets/session-sidebar/config/test-ids.js';
import {
  SESSION_PAGE_IDS,
  SUBAGENT_IDS,
  SUBAGENT_VIEW_IDS,
  TOOL_ACTIVITY_IDS,
} from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { sessionRoute, subagentRoute } from '../../apps/mini-app/src/shared/lib/routes/app-route.js';
import { byTestId } from './support/testid.js';
import { installDesktopBridge } from './support/desktop-bridge.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { baseTranscript } from './support/subagent-fixtures.js';

const deviceId = 'desktop-e2e-device';
const DESKTOP_PAGE = '/desktop.html';
const SESSION = 'terminal-session';
const AGENT = 'synthetic-reviewer';
const routeOf = (page: Page) => new URL(page.url()).hash;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test.beforeEach(async ({ page }) => {
  const snapshot = sessionSnapshot(deviceId);
  const session = snapshot.sessions.find((item) => item.id === SESSION)!;

  session.capabilities.subagentHistory = true;
  session.subagents = [{ id: AGENT, name: 'Reviewer', task: 'Review synthetic parser', status: 'completed', updatedAt: 1 }];

  const events = baseTranscript().map((message, index) => ({
    version: 1,
    deviceId,
    streamId: 'desktop-e2e',
    seq: index + 1,
    eventId: 'subagent-' + message.id,
    sessionId: SESSION,
    occurredAt: message.occurredAt,
    type: 'message',
    payload: message,
  }));

  await installDesktopBridge(page, deviceId, snapshot, { [AGENT]: events });
  await page.goto(DESKTOP_PAGE);
});

test('opens a subagent on its hash route, restores it on reload and returns to the parent route', async ({ page }) => {
  const parent = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': SESSION });

  await parent.click();
  await expect.poll(() => routeOf(page)).toBe(sessionRoute(SESSION));
  await page.getByTestId(SUBAGENT_IDS.toggle).click();
  await byTestId(page, SUBAGENT_IDS.open, { 'agent-id': AGENT }).click();

  await expect.poll(() => routeOf(page)).toBe(subagentRoute(SESSION, AGENT));
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.title)).toHaveText('Reviewer');
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.detail)).toHaveText('npm test -- parser');
  await expect(parent).toHaveAttribute('aria-selected', 'true');

  await page.reload();
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.title)).toHaveText('Reviewer');
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.root)).toBeVisible();
  await expect(parent).toHaveAttribute('aria-selected', 'true');
  expect(routeOf(page)).toBe(subagentRoute(SESSION, AGENT));

  await page.getByTestId(SUBAGENT_VIEW_IDS.back).click();
  await expect.poll(() => routeOf(page)).toBe(sessionRoute(SESSION));
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.root)).toHaveCount(0);
  await expect(parent).toHaveAttribute('aria-selected', 'true');

  await page.goBack();
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.title)).toHaveText('Reviewer');
  expect(routeOf(page)).toBe(subagentRoute(SESSION, AGENT));
});

test('opens a subagent deep link directly and leaves it when another session is selected', async ({ page }) => {
  await page.goto(DESKTOP_PAGE + subagentRoute(SESSION, AGENT));
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.title)).toHaveText('Reviewer');
  await expect(byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': SESSION })).toHaveAttribute('aria-selected', 'true');

  const otherId = sessionSnapshot(deviceId).sessions.find((item) => item.id !== SESSION)!.id;
  const other = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': otherId });

  await other.click();
  await expect.poll(() => routeOf(page)).toBe(sessionRoute(otherId));
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
});
