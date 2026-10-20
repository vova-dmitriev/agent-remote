import { expect, test } from '@playwright/test';
import { SESSION_CHANGES_IDS } from '@/entities/session/config/change-test-ids.js';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { FILE_VIEW_IDS, SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test('opens a file the session changed as formatted Markdown and goes back to the session', async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');
  const session = snapshot.sessions.find((value) => value.id === 'terminal-session')!;

  session.changes = {
    truncated: false,
    files: [
      { id: 'synthetic-write', path: '/synthetic/docs/NOTES.md', kind: 'add', truncated: false, patch: '+# Synthetic notes' },
      { id: 'synthetic-delete', path: '/synthetic/old.md', kind: 'delete', truncated: false, patch: '-gone' },
    ],
  };

  await installDesktopBridge(page, 'desktop-e2e-device', snapshot);
  await page.goto('/desktop.html');
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(SESSION_CHANGES_IDS.toggle).click();

  const files = page.getByTestId(SESSION_CHANGES_IDS.file);

  await files.nth(1).getByTestId(SESSION_CHANGES_IDS.fileToggle).click();
  // A deleted file has nothing to open.
  await expect(files.nth(1).getByTestId(SESSION_CHANGES_IDS.open)).toHaveCount(0);

  await files.nth(0).getByTestId(SESSION_CHANGES_IDS.fileToggle).click();
  await files.nth(0).getByTestId(SESSION_CHANGES_IDS.open).click();

  const view = page.getByTestId(FILE_VIEW_IDS.root);

  await expect(view.getByTestId(FILE_VIEW_IDS.path)).toHaveText('/synthetic/docs/NOTES.md');
  await expect(view.getByTestId(FILE_VIEW_IDS.content)).toContainText('Synthetic notes');
  const markup = await view.getByTestId(FILE_VIEW_IDS.content).evaluate((element) => element.innerHTML);

  expect(markup).toContain('<h1>Synthetic notes</h1>');
  expect(markup).toContain('<strong>Formatted</strong>');

  await page.getByTestId(FILE_VIEW_IDS.back).click();
  await expect(view).toHaveCount(0);
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
});
