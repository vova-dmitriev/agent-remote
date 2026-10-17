import { expect } from '@playwright/test';
import { test } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { interruptSession } from './support/session-actions.js';
import { byTestId } from './support/testid.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS, PERMISSION_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';

test('permission, multiline draft and receipt stay usable together in a short viewport', async ({ page }) => {
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('One line\nTwo lines\nThree lines\nFour lines\nFive lines');
  await interruptSession(page);
  const receipt = page.getByTestId(SHELL_IDS.receipt);

  await expect(receipt).toBeVisible();
  await page.setViewportSize({ width: 390, height: 400 });
  const composer = page.getByTestId(COMMAND_IDS.root);
  const feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expect.poll(async () => (await feed.boundingBox())!.height).toBeGreaterThan(80);

  expect((await composer.boundingBox())!.y + (await composer.boundingBox())!.height).toBeLessThanOrEqual(
    (await receipt.boundingBox())!.y,
  );

  await expect(page.getByTestId(PERMISSION_IDS.allow)).toBeInViewport();
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeInViewport();

  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue(
    'One line\nTwo lines\nThree lines\nFour lines\nFive lines',
  );
});
