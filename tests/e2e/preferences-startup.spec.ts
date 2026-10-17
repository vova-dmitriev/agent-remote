import { expect } from '@playwright/test';
import { test } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { STARTUP_IDS } from '../../apps/mini-app/src/app/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '../../apps/mini-app/src/pages/sessions/config/test-ids.js';

test('waits for saved preferences before rendering any translated page content', async ({ page }) => {
  await identity(page, '801', 'ru');
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });

  await page.route('**/preferences', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await blocked;
    await route.fulfill({ json: { language: 'en', theme: 'dark' } });
  });

  await page.addInitScript(() => {
    const seen: string[] = [];

    Object.assign(window, { startupTexts: seen });

    new MutationObserver(() => {
      if (document.body) seen.push(document.body.innerText);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });

  try {
    await page.goto('/');
    await expect(page.getByTestId(STARTUP_IDS.root)).toBeVisible();
    await expect(page.getByTestId(SESSIONS_PAGE_IDS.title)).toHaveCount(0);
  } finally { release(); }

  await expect(page.getByTestId(SESSIONS_PAGE_IDS.title)).toHaveText('Your sessions');
  expect(await page.evaluate(() => Reflect.get(window, 'startupTexts') as string[])).not.toEqual(expect.arrayContaining([expect.stringContaining('Твои сессии')]));
});
