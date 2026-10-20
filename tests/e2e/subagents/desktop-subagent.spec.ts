import { expect, test, type Page } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import {
  SESSION_PAGE_IDS,
  SUBAGENT_IDS,
  SUBAGENT_VIEW_IDS,
  TOOL_ACTIVITY_IDS,
} from '@/pages/session/config/test-ids.js';
import { sessionRoute, subagentRoute } from '@/shared/lib/routes/app-route.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge, subagentReads } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { baseTranscript } from '../support/fixtures/subagent-fixtures.js';
import { SUBAGENT_POLL_BACKOFF_MAX_MS } from '@/pages/session/config/subagent.js';

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

test('replaces a forged or over-long subagent route with its parent and never reads it', async ({ page }) => {
  for (const route of [`#/sessions/${SESSION}/agents/..%2F..`, subagentRoute(SESSION, 'x'.repeat(129))]) {
    await page.goto('about:blank');
    await page.goto(DESKTOP_PAGE + route);
    await expect.poll(() => routeOf(page), route).toBe(sessionRoute(SESSION));
    await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
    await expect(page.getByTestId(SUBAGENT_VIEW_IDS.root)).toHaveCount(0);
    expect(await subagentReads(page), route).toEqual([]);
  }
});

test('reads a well-formed subagent id that the session does not list yet, once', async ({ page }) => {
  await page.clock.install();
  await page.goto(DESKTOP_PAGE + subagentRoute(SESSION, 'unlisted-agent'));
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.title)).toHaveText('unlisted-agent');
  await expect.poll(() => subagentReads(page)).toEqual(['unlisted-agent']);
  await page.clock.fastForward(SUBAGENT_POLL_BACKOFF_MAX_MS);
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.root)).toBeVisible();
  expect(await subagentReads(page)).toEqual(['unlisted-agent']);
  expect(routeOf(page)).toBe(subagentRoute(SESSION, 'unlisted-agent'));
});
