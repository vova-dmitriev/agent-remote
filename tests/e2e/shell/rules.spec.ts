import { expect, test, type Page } from '@playwright/test';
import { ReadyRule, RuleAction, RuleScopeKind } from '@protocol';
import { RULES_BADGE_IDS } from '@/entities/rule/config/test-ids.js';
import { RULES_PAGE_IDS } from '@/pages/rules/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const database = { id: 'ready-database', name: 'Suspicious database queries', ready: ReadyRule.Database, sentence: null, patterns: ['x'] };
const push = { id: 'ready-force_push', name: 'git push --force', ready: ReadyRule.ForcePush, sentence: null, patterns: ['x'] };

const view = {
  projects: [{ root: '/synthetic/app', label: 'app', rules: [database], allowed: [] }],
  session: { id: 'terminal-session', root: '/synthetic/app', bypass: true, rules: [push], fromProject: [database], allowed: [] },
};

async function open(page: Page) {
  await installDesktopBridge(page, 'desktop-e2e-device', sessionSnapshot('desktop-e2e-device'));

  await page.addInitScript((reply) => {
    (window as unknown as { rulesReply: unknown }).rulesReply = reply;
  }, view);

  await page.goto('/desktop.html');
}

const requests = (page: Page) => page.evaluate(() => (window as unknown as { rulesRequests?: unknown[] }).rulesRequests ?? []);

test("toggles a project's ready rule from settings → Rules", async ({ page }) => {
  await open(page);
  await page.getByTestId(SHELL_IDS.settings).click();
  await page.getByTestId(SHELL_IDS.rules).click();

  await byTestId(page, RULES_PAGE_IDS.tab, { tab: '/synthetic/app' }).click();
  await expect(byTestId(page, RULES_PAGE_IDS.ready, { ready: ReadyRule.Database })).toBeChecked();

  // The fake device answers the same view, so the box goes back; the request is what counts.
  await byTestId(page, RULES_PAGE_IDS.ready, { ready: ReadyRule.ForcePush }).click();

  await expect
    .poll(() => requests(page))
    .toContainEqual({
      action: RuleAction.Toggle,
      scope: { kind: RuleScopeKind.Project, key: '/synthetic/app' },
      ready: ReadyRule.ForcePush,
      on: true,
    });
});

test("opens the session's tab from its 🛡, with the bypass notice and the project's rules", async ({ page }) => {
  await open(page);
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'terminal-session' }).click();

  const badge = page.getByTestId(RULES_BADGE_IDS.root);

  // In bypass only the session's own rule can stop a command.
  await expect(badge).toHaveAttribute('data-count', '1');
  await badge.click();

  await expect(byTestId(page, RULES_PAGE_IDS.tab, { tab: RuleScopeKind.Session })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(RULES_PAGE_IDS.bypass)).toBeVisible();
  await expect(byTestId(page, RULES_PAGE_IDS.inherited, { 'rule-id': 'ready-database' })).toBeVisible();
  await expect(byTestId(page, RULES_PAGE_IDS.ready, { ready: ReadyRule.ForcePush })).toBeChecked();
});
