import { createHash, randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { PAIR_DEVICE_IDS } from '@/features/pair-device/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SIGN_IN_IDS } from '@/pages/sign-in/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';
import { initData } from '../../helpers/relay/telegram.js';
import { identity } from '../support/relay/identity.js';
import { test } from '../support/relay/relay-fixture.js';
import { relayOrigin } from '../runtime/app-origin.js';

for (const scenario of ['invalid signature', 'expired signature'] as const) {
  test(`Telegram ${scenario} is rejected by the real HTTP authentication boundary`, async ({ page }) => {
    const data = new URLSearchParams(
      initData('801', scenario === 'expired signature' ? Date.now() - 360000 : Date.now()),
    );

    if (scenario === 'invalid signature') data.set('hash', '0'.repeat(64));
    await identity(page, '801', 'en', data.toString());
    const response = page.waitForResponse((value) => value.url().endsWith('/auth/telegram'));

    await page.goto('/');
    expect((await response).status()).toBe(401);
    await expect(page.getByTestId(SIGN_IN_IDS.title)).toBeVisible();

    await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(
      'Open the Mini App again from the Telegram bot to sign in.',
    );

    await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(0);
    await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toHaveCount(0);
  });
}

test('Telegram authentication network failure leaves no owner data and explains reconnection', async ({
  page,
}) => {
  await identity(page, '801', 'en');
  await page.route('**/auth/telegram', (route) => route.abort('connectionfailed'));
  await page.goto('/');
  await expect(page.getByTestId(SHELL_IDS.connection)).toHaveText('Offline');

  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(
    'No connection to the service. Check your internet connection and try again.',
  );

  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveCount(0);
});

test('manual pairing requires local approval and a denied claim cannot be reused', async ({ page }) => {
  const code = randomBytes(16).toString('hex');
  const proof = randomBytes(32).toString('hex');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');

  const registration = await page.request.post(`${relayOrigin}/device/pair/start`, {
    data: { codeHash: hash(code), proofHash: hash(proof) },
  });

  expect(registration.ok()).toBe(true);
  await identity(page, '802', 'en');
  await page.goto('/');
  await page.getByTestId(PAIR_DEVICE_IDS.manual).click();
  await page.getByTestId(PAIR_DEVICE_IDS.code).fill(code);
  await page.getByTestId(PAIR_DEVICE_IDS.submit).click();
  await expect(page.getByTestId(SHELL_IDS.receipt)).toHaveText('Confirm the connection locally on your Mac');
  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(0);
  const status = await page.request.post(`${relayOrigin}/device/pair/status`, { data: { proof } });
  const claim = (await status.json()) as { claimId: string; telegramId: string };

  expect(claim.telegramId).toBe('802');

  const denied = await page.request.post(`${relayOrigin}/device/pair/confirm`, {
    data: { proof, claimId: claim.claimId, approved: false },
  });

  expect(denied.ok()).toBe(true);
  await page.getByTestId(PAIR_DEVICE_IDS.code).fill(code);
  await page.getByTestId(PAIR_DEVICE_IDS.submit).click();

  await expect(page.getByTestId(COMMAND_IDS.notice)).toContainText(
    'The pairing code expired, was already entered or was not found.',
  );

  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toBeVisible();

  const reused = await page.request.post(`${relayOrigin}/device/pair/confirm`, {
    data: { proof, claimId: claim.claimId, approved: true },
  });

  expect(reused.status()).toBe(404);
});
