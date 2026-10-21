import { expect, test } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { SESSION_CREATE_IDS } from '@/features/create-session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test("starts a first session in one of the VM's projects, where the owner has no session yet", async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');

  // No session the owner could start another beside: a new user on a shared VM.
  for (const session of snapshot.sessions) session.capabilities.createSession = false;
  snapshot.projects = ['/vm/projects/alpha'];
  await installDesktopBridge(page, 'desktop-e2e-device', snapshot);
  await page.goto('/desktop.html');

  await page.getByTestId(SESSION_SIDEBAR_IDS.newSession).click();
  await expect(page.getByTestId(SESSION_CREATE_IDS.project.trigger)).toContainText('/vm/projects/alpha');
  await page.getByTestId(SESSION_CREATE_IDS.submit).click();

  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText('Project session');

  expect(await page.evaluate(() => (window as unknown as { projectSessions: unknown[] }).projectSessions)).toEqual([
    { provider: 'codex', cwd: '/vm/projects/alpha' },
  ]);
});
