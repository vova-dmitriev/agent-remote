import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { initData } from '../../helpers/relay/telegram.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';

test('reload with old Telegram launch data restores the account through the protected browser cookie', async ({ page }) => {
  await identity(page, '801', 'en');
  await page.goto('/');
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(4);
  const cookie = (await page.context().cookies()).find(item => item.name === 'agent_remote_refresh');

  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  await page.route('**/auth/telegram', route => route.continue({ postData: JSON.stringify({ initData: initData('801', Date.now() - 360000) }) }));
  await page.reload();
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(4);
});
