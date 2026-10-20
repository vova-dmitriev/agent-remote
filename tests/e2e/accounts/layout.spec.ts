import { expect } from '@playwright/test';
import { AgentProvider } from '@protocol';
import { ACCOUNTS_PAGE_IDS as PAGE } from '@/pages/accounts/config/test-ids.js';
import { PROFILE_MANAGE_IDS as FORM } from '@/pages/accounts/config/management/test-ids.js';
import { PROFILE_CARD_IDS as CARD } from '@/pages/accounts/config/profile/test-ids.js';
import { identity } from '../support/identity.js';
import { test } from '../support/relay-fixture.js';
import { profileCompanion } from './companion.js';
import { openAccounts } from '../support/settings-menu.js';

test('offers account creation, explains provider support and keeps collapsed cards compact with a checked-at gap', async ({ page }) => {
  const companion = await profileCompanion();

  try {
    await identity(page, '801', 'en');
    await page.goto('/');
    await openAccounts(page);
    await expect(page.getByTestId(PAGE.add)).toBeVisible();
    await expect(page.getByTestId(FORM.create)).toHaveCount(0);
    await page.getByTestId(PAGE.add).click();
    await page.getByTestId(FORM.label).fill('Synthetic compact account');
    await page.getByTestId(FORM.provider).selectOption(AgentProvider.Claude);
    await expect(page.getByTestId(FORM.providerHint)).toBeVisible();
    await expect(page.getByTestId(FORM.submit)).toBeDisabled();
    await expect(page.getByTestId(CARD.root)).toHaveCount(0);
    await page.getByTestId(FORM.provider).selectOption(AgentProvider.Codex);
    await page.getByTestId(FORM.submit).click();
    await expect(page.getByTestId(CARD.root)).toHaveCount(1);
    await page.getByTestId(PAGE.add).click();
    const checked = await page.getByTestId(PAGE.lastChecked).boundingBox();
    const card = await page.getByTestId(CARD.root).boundingBox();

    expect(checked).not.toBeNull();
    expect(card).not.toBeNull();
    expect(card!.y - (checked!.y + checked!.height)).toBeGreaterThanOrEqual(12);
    expect(card!.height).toBeLessThan(180);
    await expect(page.getByTestId(CARD.details)).not.toHaveAttribute('open');
    await page.getByTestId(CARD.manage).click();
    await expect(page.getByTestId(FORM.signIn)).toBeVisible();
    await expect(page.getByTestId(FORM.remove)).toBeVisible();
  } finally {
    await companion.close();
  }
});
