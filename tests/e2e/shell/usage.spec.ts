import { expect, test } from '@playwright/test';
import { AnalyticsPeriod, UsageProvider } from '@protocol';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { USAGE_PAGE_IDS } from '@/pages/usage/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const tokens = { input: 1_000, output: 20_000, cacheRead: 900_000, cacheWrite: 50_000 };
const row = (key: string, costUsd: number | null) => ({ key, label: key, tokens, costUsd });

const report = {
  period: AnalyticsPeriod.Week,
  importing: null,
  totals: { tokens, costUsd: 8.5 },
  byModel: [row('claude-opus-5-5', 12.5)],
  byProject: [row('/synthetic/project', 12.5)],
  bySession: [{ ...row('synthetic-claude-session', 12.5), provider: UsageProvider.Claude, lastAt: 1 }],
  daily: [
    { day: '2026-10-20', tokens, costUsd: 3 },
    { day: '2026-10-21', tokens, costUsd: 5.5 },
  ],
  rateLimits: [],
};

test('opens usage from settings, re-asks for another period, and narrows it to a day', async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');
  const session = snapshot.sessions.find((value) => value.id === 'terminal-session')!;

  session.usage = { tokens, costUsd: 4.2, context: null };
  await installDesktopBridge(page, 'desktop-e2e-device', snapshot);

  await page.addInitScript((value) => {
    (window as unknown as { usageReport: unknown }).usageReport = value;
  }, report);

  await page.goto('/desktop.html');

  await page.getByTestId(SHELL_IDS.settings).click();
  await page.getByTestId(SHELL_IDS.usage).click();

  const usage = page.getByTestId(USAGE_PAGE_IDS.root);

  await expect(usage.getByTestId(USAGE_PAGE_IDS.cost)).toContainText('8.50');
  await expect(byTestId(page, USAGE_PAGE_IDS.row, { key: 'claude-opus-5-5' })).toBeVisible();
  await expect(byTestId(page, USAGE_PAGE_IDS.row, { key: 'synthetic-claude-session' })).toBeVisible();

  await byTestId(page, USAGE_PAGE_IDS.period, { period: AnalyticsPeriod.Month }).click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { usageReads?: string[] }).usageReads))
    .toEqual([AnalyticsPeriod.Week, AnalyticsPeriod.Month]);

  await byTestId(page, USAGE_PAGE_IDS.day, { day: '2026-10-21' }).click();
  await expect(byTestId(page, USAGE_PAGE_IDS.day, { day: '2026-10-21' })).toHaveAttribute('aria-pressed', 'true');
  await expect(byTestId(page, USAGE_PAGE_IDS.filter, { filter: 'day' })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { usageReads?: string[] }).usageReads?.at(-1)))
    .toBe(AnalyticsPeriod.Month + ' 2026-10-21');

  await byTestId(page, USAGE_PAGE_IDS.filterClear, { filter: 'day' }).click();
  await expect(byTestId(page, USAGE_PAGE_IDS.filter, { filter: 'day' })).toHaveCount(0);

  await usage.getByTestId(USAGE_PAGE_IDS.back).click();
  await expect(usage).toHaveCount(0);
});

test("opens a session's usage from its menu, without the session's tokens in the chat", async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');

  snapshot.sessions.find((value) => value.id === 'terminal-session')!.usage = { tokens, costUsd: 4.2, context: null };
  await installDesktopBridge(page, 'desktop-e2e-device', snapshot);

  await page.addInitScript((value) => {
    (window as unknown as { usageReport: unknown }).usageReport = value;
  }, report);

  await page.goto('/desktop.html');
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).not.toContainText('4.2');

  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await page.getByTestId(SESSION_PAGE_IDS.usage).click();

  await expect(byTestId(page, USAGE_PAGE_IDS.filter, { filter: 'session' })).toBeVisible();
  await expect(byTestId(page, USAGE_PAGE_IDS.period, { period: AnalyticsPeriod.All })).toHaveAttribute('aria-pressed', 'true');

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { usageReads?: string[] }).usageReads))
    .toEqual([AnalyticsPeriod.All + ' cli-original-context']);

  await byTestId(page, USAGE_PAGE_IDS.filterClear, { filter: 'session' }).click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { usageReads?: string[] }).usageReads?.at(-1)))
    .toBe(AnalyticsPeriod.All);
});
