import { expect } from '@playwright/test';
import { test } from '../support/relay-fixture.js';
import { identity } from '../support/identity.js';
import { profileCompanion } from './companion.js';
import { ACCOUNTS_PAGE_IDS } from '../../../apps/mini-app/src/pages/accounts/config/test-ids.js';
import { PROFILE_MANAGE_IDS } from '../../../apps/mini-app/src/pages/accounts/config/management/test-ids.js';
import { PROFILE_ENROLL_IDS } from '../../../apps/mini-app/src/pages/accounts/config/enrollment/test-ids.js';
import { PROFILE_CARD_IDS } from '../../../apps/mini-app/src/pages/accounts/config/profile/test-ids.js';
import { ProfileRequestKind } from '../../../packages/protocol/src/index.js';

for (const kind of [ProfileRequestKind.Mutate, ProfileRequestKind.CompleteEnrollment]) {
  test(`recovers ${kind} after losing a committed response and reloading without repeating the write`, async ({ page }) => {
    const companion = await profileCompanion();

    try {
      await identity(page, '801', 'en');
      await page.goto('/');
      await page.getByTestId(ACCOUNTS_PAGE_IDS.open).click();
      await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
      let lost = false;

      await page.route('**/devices/*/profiles', async (route) => {
        if (!lost && route.request().postDataJSON()?.kind === kind) {
          lost = true;
          await route.fetch();
          await route.abort();
        } else { await route.continue(); }
      });

      await page.getByTestId(PROFILE_MANAGE_IDS.label).fill('Synthetic recovered account');
      await page.getByTestId(PROFILE_MANAGE_IDS.authMode).selectOption('api_key');
      await page.getByTestId(PROFILE_MANAGE_IDS.submit).click();

      if (kind === ProfileRequestKind.CompleteEnrollment) {
        await page.getByTestId(PROFILE_CARD_IDS.manage).click();
        await page.getByTestId(PROFILE_ENROLL_IDS.toggle).click();
        await page.getByTestId(PROFILE_ENROLL_IDS.pin).fill(companion.pin);
        await page.getByTestId(PROFILE_ENROLL_IDS.key).fill('synthetic-recovery-private-credential');
        await page.getByTestId(PROFILE_ENROLL_IDS.submit).click();
      }

      await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.recover)).toBeVisible();
      await expect(page.getByTestId(PROFILE_CARD_IDS.root)).toHaveCount(1);
      await page.reload();
      await page.getByTestId(ACCOUNTS_PAGE_IDS.open).click();
      await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
      await expect(page.getByTestId(PROFILE_MANAGE_IDS.submit)).toBeDisabled();
      await page.getByTestId(ACCOUNTS_PAGE_IDS.recover).click();
      await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.recover)).toHaveCount(0);
      await expect(page.getByTestId(PROFILE_MANAGE_IDS.label)).toBeEnabled();
      await expect(page.getByTestId(PROFILE_CARD_IDS.root)).toHaveCount(1);
      expect(companion.requests.filter((request) => request.kind === kind)).toHaveLength(1);
      const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));

      expect(storage).not.toContain('synthetic-recovery-private-credential');
    } finally { await companion.close(); }
  });
}
