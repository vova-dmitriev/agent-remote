import { expect } from '@playwright/test';
import { SESSION_SIDEBAR_IDS } from '@/widgets/session-sidebar/config/test-ids.js';
import { identity } from '../support/relay/identity.js';
import { test } from '../support/relay/relay-fixture.js';

// Classic scrollbars take room, as macOS shows them beside a mouse; headless Chromium hides them by default.
test.use({
  viewport: { width: 1280, height: 370 },
  isMobile: false,
  hasTouch: false,
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
});

test('switching providers keeps the sidebar list width whether or not it scrolls', async ({ page }) => {
  await identity(page, '801');
  await page.goto('/');
  const list = page.getByTestId(SESSION_SIDEBAR_IDS.list);
  const rows = page.getByTestId(SESSION_SIDEBAR_IDS.row);
  const measure = () => list.evaluate((node) => ({ width: node.clientWidth, scrolls: node.scrollHeight > node.clientHeight }));

  await expect(rows).toHaveCount(4);
  const all = await measure();

  await page.getByTestId(SESSION_SIDEBAR_IDS.providerCodex).click();
  await expect(rows).toHaveCount(2);
  const codex = await measure();

  expect([all.scrolls, codex.scrolls]).toEqual([true, false]);
  expect(codex.width).toBe(all.width);
});
