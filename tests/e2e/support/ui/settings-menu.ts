import type { Page } from '@playwright/test';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';

/** Opens Accounts & keys through the header settings menu. */
export async function openAccounts(page: Page) {
  await page.getByTestId(SHELL_IDS.settings).click();
  await page.getByTestId(SHELL_IDS.accounts).click();
}

/** Signs out through the settings menu's last item and confirms in the dialog that asks first. */
export async function signOut(page: Page) {
  await page.getByTestId(SHELL_IDS.settings).click();
  await page.getByTestId(SHELL_IDS.logout).click();
  await page.getByTestId(SHELL_IDS.logoutConfirm.confirm).click();
}
