import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { LINK_EXTENSION_IDS, SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';

const EXTENSION = 'chrome-extension://' + 'b'.repeat(32);

test('shows a one-time code in the settings that links the Chrome extension once', async ({ page }) => {
  await identity(page, '801', 'en');
  await page.goto('/');
  await expect(page.getByTestId(SESSION_CARD_IDS.root).first()).toBeVisible();

  await page.getByTestId(SHELL_IDS.settings).click();
  await page.getByTestId(LINK_EXTENSION_IDS.open).click();

  const code = page.getByTestId(LINK_EXTENSION_IDS.code);

  await expect(code).toHaveText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u);
  await expect(page.getByTestId(LINK_EXTENSION_IDS.expires)).toContainText(/Valid for [45]:\d\d/u);

  // The extension redeems the code from its own origin once; a second try is refused.
  const redeem = () => page.request.post('/auth/link', { headers: { origin: EXTENSION }, data: { code: '' } });
  const typed = (await code.textContent())!;
  const linked = await page.request.post('/auth/link', { headers: { origin: EXTENSION }, data: { code: typed } });

  expect(linked.ok()).toBe(true);
  expect(Object.keys(await linked.json()).sort()).toEqual(['expiresAt', 'refresh', 'token']);
  expect((await page.request.post('/auth/link', { headers: { origin: EXTENSION }, data: { code: typed } })).status()).toBe(401);
  expect((await redeem()).ok()).toBe(false);

  await page.getByTestId(LINK_EXTENSION_IDS.done).click();
  await expect(page.getByTestId(LINK_EXTENSION_IDS.dialog)).toBeHidden();
});
