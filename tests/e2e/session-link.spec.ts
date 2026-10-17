import { expect } from '@playwright/test';
import { test } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '../../apps/mini-app/src/pages/sessions/config/test-ids.js';

test('notification link opens only its owned session and back remains in the session list', async ({
  page,
}) => {
  await identity(page, '801', 'en');
  await page.goto('/#session=chat-session');
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText('Selected chat');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toHaveCount(0);
});

test('unknown or another owner session link never substitutes a different session', async ({ page }) => {
  await identity(page, '801', 'en');
  await page.goto('/#session=private-other-owner');
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toHaveCount(0);
});
