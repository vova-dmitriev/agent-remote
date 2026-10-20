import { createHash, randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import { test, completeBotPairing } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { PAIR_DEVICE_IDS } from '../../apps/mini-app/src/features/pair-device/config/test-ids.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';
import { relayOrigin } from './runtime/app-origin.js';

test('an unavailable pairing code explains recovery and a fresh code clears the error', async ({ page }) => {
  await identity(page, '802', 'ru');
  await page.goto('/');
  await expect(page.getByTestId(PAIR_DEVICE_IDS.command)).toHaveText('npm run personal');
  await expect(page.getByTestId(PAIR_DEVICE_IDS.code)).toBeHidden();
  await page.screenshot({ path: 'artifacts/pairing-simple-mobile.png', fullPage: true });
  await page.getByTestId(PAIR_DEVICE_IDS.manual).click();
  await page.getByTestId(PAIR_DEVICE_IDS.code).fill('expired-synthetic-code');
  await page.getByTestId(PAIR_DEVICE_IDS.submit).click();

  await expect(page.getByTestId(COMMAND_IDS.notice)).toContainText(
    'Заново запусти команду подключения на Mac',
  );

  const code = randomBytes(16).toString('hex');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');

  const registration = await page.request.post(`${relayOrigin}/device/pair/start`, {
    data: { codeHash: hash(code), proofHash: hash(randomBytes(32).toString('hex')) },
  });

  expect(registration.ok()).toBe(true);
  await page.getByTestId(PAIR_DEVICE_IDS.code).fill(code);
  await page.getByTestId(PAIR_DEVICE_IDS.submit).click();
  await expect(page.getByTestId(SHELL_IDS.receipt)).toContainText('Подтверди подключение локально на Mac');
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveCount(0);
});

test('an open Mini App discovers bot pairing after local confirmation without a reload', async ({ page }) => {
  await identity(page, '802');
  await page.goto('/');
  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toBeVisible();
  await completeBotPairing(802);
  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toHaveCount(0);
});
