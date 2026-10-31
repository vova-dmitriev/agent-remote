import { expect, test } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { installDesktopBridge } from '../../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 } });

test('the desktop sidebar groups by project, and the keyboard skips a collapsed group', async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');

  snapshot.sessions.forEach((session, index) => {
    session.cwd = index === 0 ? '/synthetic/alpha' : '/synthetic/beta';
    session.lastMessageAt = 100 - index;
  });

  await installDesktopBridge(page, 'desktop-e2e-device', snapshot, {}, []);
  await page.goto('/desktop.html');

  const groups = page.getByTestId(SESSION_SIDEBAR_IDS.group);
  const beta = groups.last();
  const rows = page.getByTestId(SESSION_SIDEBAR_IDS.row);

  await expect(groups).toHaveCount(2);
  await expect(beta).toHaveAttribute('data-group', '/synthetic/beta');
  await expect(rows).toHaveCount(snapshot.sessions.length);

  await beta.getByTestId(SESSION_SIDEBAR_IDS.groupToggle).click();
  await expect(rows).toHaveCount(1);

  await page.getByTestId(SESSION_SIDEBAR_IDS.list).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(rows.first()).toHaveAttribute('data-cursor', 'true');

  await page.reload();
  await expect(groups.last()).toHaveAttribute('data-open', 'false');
});
