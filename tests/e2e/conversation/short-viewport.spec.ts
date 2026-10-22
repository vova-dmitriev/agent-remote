import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { interruptSession } from '../support/ui/session-actions.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS, PERMISSION_IDS } from '@/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';

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

  // The receipt passes over the chat, just above the composer.
  const frame = (await page.getByTestId(SESSION_FEED_IDS.frame).boundingBox())!;
  const passing = (await receipt.boundingBox())!;

  expect(passing.y + passing.height).toBeLessThanOrEqual((await composer.boundingBox())!.y);
  expect(passing.y).toBeGreaterThanOrEqual(frame.y);

  await expect(page.getByTestId(PERMISSION_IDS.allow)).toBeInViewport();
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeInViewport();

  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue(
    'One line\nTwo lines\nThree lines\nFour lines\nFive lines',
  );
});
