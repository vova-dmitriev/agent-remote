import { expect } from '@playwright/test';
import { ACCOUNTS_PAGE_IDS } from '@/pages/accounts/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '@/pages/sessions/config/test-ids.js';
import { byTestId } from './support/testid.js';
import { identity } from './support/identity.js';
import { test } from './support/relay-fixture.js';
import { deviceFixture } from './support/relay-fixture.js';
import { profileCompanion } from './accounts/companion.js';
import { PROFILE_MANAGE_IDS } from '@/pages/accounts/config/management/test-ids.js';
import { PROFILE_ENROLL_IDS } from '@/pages/accounts/config/enrollment/test-ids.js';
import { PROFILE_CARD_IDS } from '@/pages/accounts/config/profile/test-ids.js';
import { openAccounts } from './support/settings-menu.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';

/** The pre-menu "Accounts & keys" button under the session list; it must not come back. */
const LEGACY_ACCOUNTS_BUTTON = 'accounts-open';

test('opens Accounts & keys from the header settings menu instead of a button under the session list', async ({ page }) => {
  await identity(page, '801', 'en');
  await page.goto('/');
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.list)).toBeVisible();
  await expect(page.getByTestId(LEGACY_ACCOUNTS_BUTTON)).toHaveCount(0);
  await expect(page.getByTestId(SHELL_IDS.accounts)).toHaveCount(0);
  await page.getByTestId(SHELL_IDS.settings).click();
  await expect(page.getByTestId(SHELL_IDS.settingsMenu)).toBeVisible();
  await page.getByTestId(SHELL_IDS.accounts).click();
  await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SHELL_IDS.settingsMenu)).toHaveCount(0);
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.root)).toHaveCount(0);
});

test('opens the shared Accounts & keys page and preserves the provider filter when returning', async ({ page }) => {
  const companion = await profileCompanion();

  try {
  await identity(page, '801', 'en');
  await page.goto('/');
  await page.getByTestId(SESSIONS_PAGE_IDS.filterClaude).click();
  await openAccounts(page);
  await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
  await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.title)).toBeVisible();
  await page.getByTestId(ACCOUNTS_PAGE_IDS.back).click();
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.filterClaude)).toHaveAttribute('aria-pressed', 'true');
  } finally { await companion.close(); }
});

test('encrypts an API key in the browser, verifies it on the Mac and retains profile CRUD after reopening', async ({ page }) => {
  const companion = await profileCompanion();

  try {
    await identity(page, '801', 'en');
    await page.goto('/');
    await openAccounts(page);
    await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
    await page.getByTestId(PROFILE_MANAGE_IDS.label).fill('Synthetic API account');
    await page.getByTestId(PROFILE_MANAGE_IDS.authMode).selectOption('api_key');
    await page.getByTestId(PROFILE_MANAGE_IDS.submit).click();
    const card = page.getByTestId(PROFILE_CARD_IDS.root);

    await expect(card).toHaveCount(1);
    await card.getByTestId(PROFILE_CARD_IDS.manage).click();
    await card.getByTestId(PROFILE_ENROLL_IDS.toggle).click();
    await card.getByTestId(PROFILE_ENROLL_IDS.pin).fill(companion.pin);
    await card.getByTestId(PROFILE_ENROLL_IDS.key).fill('synthetic-browser-private-api-credential');
    await card.getByTestId(PROFILE_ENROLL_IDS.submit).click();
    await expect(card.getByTestId(PROFILE_CARD_IDS.status)).toHaveText('Connected');
    await expect(card.getByTestId(PROFILE_ENROLL_IDS.form)).toHaveCount(0);
    expect(JSON.stringify(companion.requests)).not.toContain('synthetic-browser-private-api-credential');
    expect(companion.requests.some((request) => request.kind === 'complete_enrollment')).toBe(true);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));

    expect(storage).not.toContain('synthetic-browser-private-api-credential');
    expect(JSON.stringify(companion.database.connection.prepare('SELECT value FROM profile_operations').all())).not.toContain('synthetic-browser-private-api-credential');
    await card.getByTestId(PROFILE_MANAGE_IDS.setDefault).click();
    await expect(card.getByTestId(PROFILE_CARD_IDS.preferred)).toBeVisible();
    await card.getByTestId(PROFILE_MANAGE_IDS.rename).click();
    await card.getByTestId(PROFILE_MANAGE_IDS.renameInput).fill('Renamed synthetic account');
    await card.getByTestId(PROFILE_MANAGE_IDS.save).click();
    await expect(card.getByTestId(PROFILE_CARD_IDS.label)).toHaveText('Renamed synthetic account');
    await card.getByTestId(PROFILE_MANAGE_IDS.enabled).click();
    await expect(card.getByTestId(PROFILE_CARD_IDS.status)).toHaveText('Disabled');
    await expect(card.getByTestId(PROFILE_CARD_IDS.preferred)).toHaveCount(0);
    await page.reload();
    await openAccounts(page);
    await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
    await expect(card.getByTestId(PROFILE_CARD_IDS.label)).toHaveText('Renamed synthetic account');
    await expect(card.getByTestId(PROFILE_CARD_IDS.status)).toHaveText('Disabled');
    await card.getByTestId(PROFILE_CARD_IDS.manage).click();
    await card.getByTestId(PROFILE_MANAGE_IDS.remove).click();
    await expect(card).toHaveCount(0);
  } finally { await companion.close(); }
});

test('retains two isolated OpenAI subscription identities without replacing the first login', async ({ page }) => {
  const companion = await profileCompanion();

  try {
    await identity(page, '801', 'en');
    await page.goto('/');
    await openAccounts(page);
    await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();

    for (const [index, label] of ['Synthetic personal', 'Synthetic work'].entries()) {
      await page.getByTestId(PROFILE_MANAGE_IDS.label).fill(label);
      await page.getByTestId(PROFILE_MANAGE_IDS.submit).click();
      await expect(page.getByTestId(PROFILE_CARD_IDS.root)).toHaveCount(index + 1);
      const list = await companion.runtime.request({ kind: 'list' });

      if (list.kind !== 'list') { throw new Error('SYNTHETIC_LIST_MISSING'); }

      const profile = list.data.profiles.find((entry) => entry.label === label)!;
      const card = byTestId(page, PROFILE_CARD_IDS.root, { 'profile-id': profile.id });

      await card.getByTestId(PROFILE_CARD_IDS.manage).click();
      await card.getByTestId(PROFILE_MANAGE_IDS.signIn).click();
      await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.login)).toBeVisible();
      await card.getByTestId(PROFILE_MANAGE_IDS.reconcile).click();
      await expect(card.getByTestId(PROFILE_CARD_IDS.status)).toHaveText('Connected');
    }

    const before = await page.getByTestId(PROFILE_CARD_IDS.identity).allTextContents();

    expect(before).toHaveLength(2);
    expect(new Set(before).size).toBe(2);
    await page.reload();
    await openAccounts(page);
    await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
    await expect(page.getByTestId(PROFILE_CARD_IDS.identity)).toHaveText(before);
  } finally { await companion.close(); }
});

test('restores safe cached metadata while the Mac is offline and disables account mutations', async ({ page }) => {
  const companion = await profileCompanion();

  try {
    await identity(page, '801', 'en');
    await page.goto('/');
    await openAccounts(page);
    await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
    await page.getByTestId(PROFILE_MANAGE_IDS.label).fill('Synthetic offline account');
    await page.getByTestId(PROFILE_MANAGE_IDS.submit).click();
    await expect(page.getByTestId(PROFILE_CARD_IDS.root)).toHaveCount(1);
    deviceFixture().sockets[0]!.close();
    await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.offline)).toBeVisible();
    await page.reload();
    await openAccounts(page);
    await page.getByTestId(ACCOUNTS_PAGE_IDS.add).click();
    await expect(page.getByTestId(PROFILE_CARD_IDS.label)).toHaveText('Synthetic offline account');
    await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.offline)).toBeVisible();
    await expect(page.getByTestId(PROFILE_MANAGE_IDS.submit)).toBeDisabled();
    await expect(page.getByTestId(PROFILE_MANAGE_IDS.remove)).toBeDisabled();
    await companion.reconnect();
    await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.offline)).toHaveCount(0);
    await expect(page.getByTestId(ACCOUNTS_PAGE_IDS.refresh)).toBeEnabled();
    await expect(page.getByTestId(PROFILE_MANAGE_IDS.label)).toBeEnabled();
  } finally { await companion.close(); }
});
