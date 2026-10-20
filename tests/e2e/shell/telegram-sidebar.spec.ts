import { expect } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '@/pages/sessions/config/test-ids.js';
import { identity } from '../support/relay/identity.js';
import { test } from '../support/relay/relay-fixture.js';
import { byTestId } from '../support/ui/testid.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test('the Telegram Mini App shows the session sidebar on a wide screen and keeps its own URL hash', async ({ page }) => {
  await identity(page, '801');
  await page.goto('/');
  const hash = new URL(page.url()).hash;

  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.root)).toHaveCount(0);

  const row = byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' });

  await row.click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).hash).toBe(hash);

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByTestId(SESSION_SIDEBAR_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
});
