import { expect } from '@playwright/test';
import { test } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { installSource, sourceCases } from './product/sources.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';

test('an unavailable source has a concise placeholder without an internal scrollbar on a small screen', async ({
  page,
}) => {
  await installSource(sourceCases[0]);
  await page.setViewportSize({ width: 320, height: 400 });
  await identity(page, '801', 'ru');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'matrix-session' }).click();
  const prompt = page.getByTestId(COMMAND_IDS.prompt);

  await expect(prompt).toBeDisabled();
  await expect(prompt).toHaveCSS('overflow-y', 'hidden');
  await expect(prompt).toHaveAttribute('placeholder', 'Ввод недоступен');
  expect(await prompt.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  await page.screenshot({ path: 'artifacts/readonly-composer-compact.png', animations: 'disabled' });
});
