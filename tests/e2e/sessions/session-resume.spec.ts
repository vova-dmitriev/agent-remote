import { expect, test } from '@playwright/test';
import { SessionStatus } from '@protocol';
import { SESSION_CREATE_IDS } from '@/features/create-session/config/test-ids.js';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { byTestId } from '../support/ui/testid.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test('a dead session restarts with one press, continuing its own conversation; a live one offers no restart', async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');
  const dead = snapshot.sessions.find((session) => session.id === 'terminal-session')!;
  const live = snapshot.sessions.find((session) => session.id !== dead.id && session.status !== SessionStatus.Ended)!;

  Object.assign(dead, { status: SessionStatus.Ended, cwd: '/synthetic/project', claudeSessionId: 'synthetic-claude-id' });
  await installDesktopBridge(page, 'desktop-e2e-device', snapshot, {}, []);
  await page.goto('/desktop.html');

  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': dead.id }).click();
  await page.getByTestId(SESSION_CREATE_IDS.resumeSession).click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { projectSessions?: unknown[] }).projectSessions))
    .toEqual([{ provider: 'claude', cwd: '/synthetic/project', resume: 'synthetic-claude-id' }]);

  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': live.id }).click();
  await expect(page.getByTestId(SESSION_CREATE_IDS.resumeSession)).toHaveCount(0);
});
