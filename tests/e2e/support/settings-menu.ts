import type { Page } from '@playwright/test';
import { SHELL_IDS } from '../../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';

/** Opens Accounts & keys through the header settings menu. */
export async function openAccounts(page: Page) {
  await page.getByTestId(SHELL_IDS.settings).click();
  await page.getByTestId(SHELL_IDS.accounts).click();
}
