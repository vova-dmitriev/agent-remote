import { expect, test } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { SWITCH_MODEL_IDS } from '@/features/switch-model/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';
import { installDesktopBridge } from '../support/fixtures/desktop-bridge.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

test('switches a Codex session to another model and effort from its header', async ({ page }) => {
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

  const model = page.getByTestId(SWITCH_MODEL_IDS.model.trigger);

  await model.click();
  await byTestId(page, SWITCH_MODEL_IDS.modelOption, { value: 'synthetic-deep' }).click();
  await expect(model).toHaveAttribute('data-value', 'synthetic-deep');

  await page.getByTestId(SWITCH_MODEL_IDS.effort.trigger).click();
  await byTestId(page, SWITCH_MODEL_IDS.effortOption, { value: 'high' }).click();
  await expect(page.getByTestId(SWITCH_MODEL_IDS.effort.trigger)).toHaveAttribute('data-value', 'high');

  expect(await page.evaluate(() => (window as unknown as { modelSwitches: unknown[] }).modelSwitches)).toEqual([
    { sessionId: 'codex-cli-session', choice: { model: 'synthetic-deep' } },
    { sessionId: 'codex-cli-session', choice: { model: 'synthetic-deep', effort: 'high' } },
  ]);
});

test('offers no model chips when the device lists no models', async ({ page }) => {
  await installDesktopBridge(page, 'desktop-e2e-device', sessionSnapshot('desktop-e2e-device'));
  await page.goto('/desktop.html');
  await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': 'codex-cli-session' }).click();

  await expect(page.getByTestId(SWITCH_MODEL_IDS.model.trigger)).toHaveCount(0);
});
