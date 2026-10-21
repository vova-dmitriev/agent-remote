import { expect, test } from '@playwright/test';
import { UsageProvider } from '@protocol';
import { RATE_LIMIT_IDS } from '@/entities/usage/config/test-ids.js';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test("shows the session agent's plan limits in the header and their details on click", async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');
  const now = Date.now();

  const window = (provider: UsageProvider, windowMinutes: number, usedPercent: number) => ({
    provider,
    windowMinutes,
    usedPercent,
    resetsAt: now + 3_600_000,
    observedAt: now,
  });

  snapshot.rateLimits = [
    window(UsageProvider.Claude, 10_080, 74),
    window(UsageProvider.Claude, 300, 6),
    window(UsageProvider.Codex, 300, 50),
  ];

  await installDesktopBridge(page, 'desktop-e2e-device', snapshot);
  await page.goto('/desktop.html');
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' }).click();

  const windows = page.getByTestId(RATE_LIMIT_IDS.window);

  await expect(windows).toHaveCount(2);
  await expect(windows.nth(0)).toHaveAttribute('data-window-minutes', '300');
  await expect(windows.nth(0)).toContainText('6%');
  await expect(windows.nth(1)).toContainText('74%');

  await page.getByTestId(RATE_LIMIT_IDS.trigger).click();
  await expect(page.getByTestId(RATE_LIMIT_IDS.details).getByTestId(RATE_LIMIT_IDS.detail)).toHaveCount(2);
  await expect(page.getByTestId(RATE_LIMIT_IDS.stale)).toHaveCount(0);
});
