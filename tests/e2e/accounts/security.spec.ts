import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { profileCompanion } from './companion.js';
import { ACCOUNTS_PAGE_IDS } from '@/pages/accounts/config/test-ids.js';
import { PROFILE_MANAGE_IDS } from '@/pages/accounts/config/management/test-ids.js';
import { PROFILE_ENROLL_IDS } from '@/pages/accounts/config/enrollment/test-ids.js';
import { PROFILE_CARD_IDS } from '@/pages/accounts/config/profile/test-ids.js';
import { SIGN_IN_IDS } from '@/pages/sign-in/config/test-ids.js';
import { openAccounts, signOut } from '../support/ui/settings-menu.js';

test('refuses an untrusted Mac fingerprint before any key reaches native enrollment', async ({ page }) => {
  const companion = await profileCompanion();

  try {
    await identity(page, '801', 'en');
    await page.goto('/');
    await openAccounts(page);
    await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
    await page.getByTestId(PROFILE_MANAGE_IDS.label).fill('Synthetic untrusted recipient');
    await page.getByTestId(PROFILE_MANAGE_IDS.authMode).selectOption('api_key');
    await page.getByTestId(PROFILE_MANAGE_IDS.submit).click();
    await page.getByTestId(PROFILE_CARD_IDS.manage).click();
    await page.getByTestId(PROFILE_ENROLL_IDS.toggle).click();
    await page.getByTestId(PROFILE_ENROLL_IDS.pin).fill('0'.repeat(64));
    await page.getByTestId(PROFILE_ENROLL_IDS.key).fill('synthetic-untrusted-secret');
    await page.getByTestId(PROFILE_ENROLL_IDS.submit).click();
    await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.error)).toContainText('The Mac fingerprint does not match.');
    await expect(page.getByTestId(PROFILE_ENROLL_IDS.key)).toHaveValue('');
    expect(companion.requests.some((request) => request.kind === 'complete_enrollment')).toBe(false);
    expect(JSON.stringify(companion.requests)).not.toContain('synthetic-untrusted-secret');
  } finally { await companion.close(); }
});

test('logout cancels the in-flight Mac operation before verified credentials can activate the profile', async ({ page }) => {
  let reached!: () => void;
  let release!: () => void;
  const checking = new Promise<void>((resolve) => { reached = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const companion = await profileCompanion({ beforeApi: async () => { reached(); await held; } });

  try {
    await identity(page, '801', 'en');
    await page.goto('/');
    await openAccounts(page);
    await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
    await page.getByTestId(PROFILE_MANAGE_IDS.label).fill('Synthetic cancelled enrollment');
    await page.getByTestId(PROFILE_MANAGE_IDS.authMode).selectOption('api_key');
    await page.getByTestId(PROFILE_MANAGE_IDS.submit).click();
    await page.getByTestId(PROFILE_CARD_IDS.manage).click();
    await page.getByTestId(PROFILE_ENROLL_IDS.toggle).click();
    await page.getByTestId(PROFILE_ENROLL_IDS.pin).fill(companion.pin);
    await page.getByTestId(PROFILE_ENROLL_IDS.key).fill('synthetic-cancelled-secret');
    await page.getByTestId(PROFILE_ENROLL_IDS.submit).click();
    await checking;
    await signOut(page);
    await expect(page.getByTestId(SIGN_IN_IDS.title)).toBeVisible();
    await expect.poll(() => companion.cancelledRequests.length).toBeGreaterThan(0);
    release();
    await companion.idle();
    const list = await companion.runtime.request({ kind: 'list' });

    expect(list.kind === 'list' && list.data.profiles[0]?.status).toBe('needs_authentication');
    await expect(page.getByTestId(PROFILE_CARD_IDS.root)).toHaveCount(0);
    expect(JSON.stringify(companion.requests)).not.toContain('synthetic-cancelled-secret');
  } finally { release(); await companion.close(); }
});
