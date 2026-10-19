import { expect } from '@playwright/test';
import { test } from './fixture.js';
import { ProfileAuthMode } from '@protocol';
import { ACCOUNTS_PAGE_IDS } from '../../apps/mini-app/src/pages/accounts/config/test-ids.js';
import { PROFILE_MANAGE_IDS } from '../../apps/mini-app/src/pages/accounts/config/management/test-ids.js';
import { PROFILE_ENROLL_IDS } from '../../apps/mini-app/src/pages/accounts/config/enrollment/test-ids.js';
import { PROFILE_CARD_IDS } from '../../apps/mini-app/src/pages/accounts/config/profile/test-ids.js';
import { openAccounts } from '../e2e/support/settings-menu.js';

interface BrowserStorageScope {
  chrome: { storage: { local: { get(keys: null): Promise<Record<string, unknown>> } } };
}

test('encrypts and enrolls a profile through built MV3 UI and the real native bridge under production CSP', async ({
  extension,
}) => {
  const page = await extension.open();

  await openAccounts(page);
  await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
  await page.getByTestId(PROFILE_MANAGE_IDS.label).fill('Synthetic extension API');
  await page.getByTestId(PROFILE_MANAGE_IDS.authMode).selectOption(ProfileAuthMode.ApiKey);
  await page.getByTestId(PROFILE_MANAGE_IDS.submit).click();
  const card = page.getByTestId(PROFILE_CARD_IDS.root);

  await expect(card).toHaveCount(1);
  await card.getByTestId(PROFILE_CARD_IDS.manage).click();
  await card.getByTestId(PROFILE_ENROLL_IDS.toggle).click();
  await card.getByTestId(PROFILE_ENROLL_IDS.pin).fill(extension.profiles.pin);
  await card.getByTestId(PROFILE_ENROLL_IDS.key).fill('synthetic-extension-private-key');
  await card.getByTestId(PROFILE_ENROLL_IDS.submit).click();
  await expect(card.getByTestId(PROFILE_CARD_IDS.status)).toHaveText('Connected');

  const storage = await page.evaluate(async () => {
    const scope = globalThis as unknown as BrowserStorageScope;

    return JSON.stringify(await scope.chrome.storage.local.get(null));
  });

  expect(storage).not.toContain('synthetic-extension-private-key');
  const result = await extension.profiles.runtime.request({ kind: 'list' });

  expect(result.kind === 'list' && result.data.profiles[0]?.status).toBe('ready');
  expect(JSON.stringify(result)).not.toContain('synthetic-extension-private-key');
  expect(extension.errors).toEqual([]);
});
