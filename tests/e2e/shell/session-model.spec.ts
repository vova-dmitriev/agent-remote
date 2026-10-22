import { expect, test, type Page } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { SWITCH_MODEL_IDS } from '@/features/switch-model/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

/** Opens the model dialog from the session's "…" menu. */
async function openModels(page: Page) {
  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await page.getByTestId(SWITCH_MODEL_IDS.open).click();
  await expect(page.getByTestId(SWITCH_MODEL_IDS.dialog)).toBeVisible();
}

const option = (page: Page, id: string, value: string) => byTestId(page, id, { value });

test('switches a Codex session to another model and effort from its menu', async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');

  snapshot.models = [
    {
      provider: 'codex',
      models: [
        { id: 'synthetic-fast', efforts: [] },
        { id: 'synthetic-deep', efforts: ['low', 'high'] },
      ],
    },
  ];

  await installDesktopBridge(page, 'desktop-e2e-device', snapshot);
  await page.goto('/desktop.html');
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' }).click();

  await openModels(page);
  await option(page, SWITCH_MODEL_IDS.modelOption, 'synthetic-deep').click();
  await expect(option(page, SWITCH_MODEL_IDS.modelOption, 'synthetic-deep')).toHaveAttribute('aria-checked', 'true');
  await option(page, SWITCH_MODEL_IDS.effortOption, 'high').click();
  await expect(option(page, SWITCH_MODEL_IDS.effortOption, 'high')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId(SWITCH_MODEL_IDS.done).click();
  await expect(page.getByTestId(SWITCH_MODEL_IDS.dialog)).toBeHidden();
  // The menu names the model the session now runs.
  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await expect(page.getByTestId(SWITCH_MODEL_IDS.open)).toContainText('synthetic-deep');

  expect(await page.evaluate(() => (window as unknown as { modelSwitches: unknown[] }).modelSwitches)).toEqual([
    { sessionId: 'codex-cli-session', choice: { model: 'synthetic-deep' } },
    { sessionId: 'codex-cli-session', choice: { model: 'synthetic-deep', effort: 'high' } },
  ]);
});

test("says why the device refused a model switch and keeps the session's model", async ({ page }) => {
  const snapshot = sessionSnapshot('desktop-e2e-device');

  snapshot.models = [{ provider: 'codex', models: [{ id: 'synthetic-fast', efforts: [] }] }];
  await installDesktopBridge(page, 'desktop-e2e-device', snapshot);
  await page.goto('/desktop.html');
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' }).click();
  await page.evaluate(() => ((window as unknown as { modelRefused: boolean }).modelRefused = true));

  await openModels(page);
  await option(page, SWITCH_MODEL_IDS.modelOption, 'synthetic-fast').click();
  await expect(option(page, SWITCH_MODEL_IDS.modelOption, 'synthetic-fast')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(SWITCH_MODEL_IDS.error)).toContainText('Couldn’t switch the model:');
});

test('offers no models in the menu when the device lists none', async ({ page }) => {
  await installDesktopBridge(page, 'desktop-e2e-device', sessionSnapshot('desktop-e2e-device'));
  await page.goto('/desktop.html');
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' }).click();

  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await expect(page.getByTestId(SWITCH_MODEL_IDS.open)).toHaveCount(0);
});

test("copies a session's own id from its menu", async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installDesktopBridge(page, 'desktop-e2e-device', sessionSnapshot('desktop-e2e-device'));
  await page.goto('/desktop.html');
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' }).click();

  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await page.getByTestId(SESSION_PAGE_IDS.copyId).click();

  await expect(page.getByTestId(SESSION_PAGE_IDS.idCopied)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('codex-cli-thread');
});
