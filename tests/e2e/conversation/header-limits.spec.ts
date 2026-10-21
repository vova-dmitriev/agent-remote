import { expect } from '@playwright/test';
import { UsageProvider } from '@protocol';
import { test, deviceFixture } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { RATE_LIMIT_IDS } from '@/entities/usage/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';

test('on a phone the plan limits sit at the right of the status line, leaving the title its room', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const { sockets, deviceId } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);
  const now = Date.now();

  snapshot.rateLimits = [
    { provider: UsageProvider.Claude, windowMinutes: 300, usedPercent: 3, resetsAt: now + 3_600_000, observedAt: now },
    { provider: UsageProvider.Claude, windowMinutes: 10_080, usedPercent: 5, resetsAt: now + 86_400_000, observedAt: now },
  ];

  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  const title = (await page.getByTestId(SESSION_PAGE_IDS.title).boundingBox())!;
  const status = (await page.getByTestId(SESSION_PAGE_IDS.status).boundingBox())!;
  const limits = (await page.getByTestId(RATE_LIMIT_IDS.trigger).boundingBox())!;

  // Below the title and its status, flush with the right edge of the page.
  expect(limits.y).toBeGreaterThan(title.y + title.height);
  expect(limits.y).toBeGreaterThanOrEqual(status.y);
  expect(390 - (limits.x + limits.width)).toBeLessThan(24);
  await page.screenshot({ path: 'artifacts/session-header-limits-mobile.png', clip: { x: 0, y: 0, width: 390, height: 160 } });
});
