import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SIGN_IN_IDS } from '@/pages/sign-in/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';

test('signs out from the bottom of the settings menu, only after the owner confirms', async ({ page }) => {
  await identity(page, '801', 'en');
  await page.goto('/');
  await expect(page.getByTestId(SESSION_CARD_IDS.root).first()).toBeVisible();

  await page.getByTestId(SHELL_IDS.settings).click();

  const menu = page.getByTestId(SHELL_IDS.settingsMenu);
  const logout = page.getByTestId(SHELL_IDS.logout);

  // Last, below a separator that sets it apart from the other items, in the danger color.
  const rules = (await menu.getByTestId(SHELL_IDS.accounts).boundingBox())!;
  const separator = (await menu.getByTestId(SHELL_IDS.settingsSeparator).boundingBox())!;
  const last = (await logout.boundingBox())!;

  expect(separator.y).toBeGreaterThan(rules.y);
  expect(last.y).toBeGreaterThan(separator.y);
  await expect(logout).toHaveClass(/text-danger/);

  await logout.click();
  await expect(page.getByTestId(SHELL_IDS.logoutConfirm.root)).toBeVisible();
  await page.getByTestId(SHELL_IDS.logoutConfirm.cancel).click();
  await expect(page.getByTestId(SHELL_IDS.logoutConfirm.root)).toBeHidden();
  await expect(page.getByTestId(SESSION_CARD_IDS.root).first()).toBeVisible();

  await page.getByTestId(SHELL_IDS.settings).click();
  await logout.click();
  await page.getByTestId(SHELL_IDS.logoutConfirm.confirm).click();
  await expect(page.getByTestId(SIGN_IN_IDS.title)).toBeVisible();
});
