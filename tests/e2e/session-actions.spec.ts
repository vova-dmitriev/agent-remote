import { expect } from '@playwright/test';
import { test, delivered } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { publishSnapshot } from './product/device.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

test('interrupt is away from the composer and only dispatches after a deliberate menu selection', async ({
  page,
}) => {
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const composer = page.getByTestId(COMMAND_IDS.root);
  const trigger = page.getByTestId(COMMAND_IDS.actionsTrigger);
  const interrupt = page.getByTestId(COMMAND_IDS.interrupt);

  await expect(composer.getByTestId(COMMAND_IDS.interrupt)).toHaveCount(0);
  await expect(interrupt).toBeHidden();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic next draft');
  await trigger.click();
  await expect(interrupt).toBeVisible();
  expect(delivered).toHaveLength(0);
  expect((await trigger.boundingBox())!.y).toBeLessThan((await composer.boundingBox())!.y - 100);
  await interrupt.press('Escape');
  await expect(interrupt).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await expect(interrupt).toBeVisible();
  await page.getByTestId(COMMAND_IDS.prompt).click();
  await expect(interrupt).toBeHidden();
  expect(delivered).toHaveLength(0);
  await trigger.click();
  await interrupt.click();
  await expect.poll(() => delivered.length).toBe(1);
  expect(delivered[0]).toMatchObject({ sessionId: 'terminal-session', action: { type: 'interrupt' } });
  await expect(interrupt).toBeHidden();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Synthetic next draft');
  await page.screenshot({ path: 'artifacts/session-safe-interrupt.png', animations: 'disabled' });
});

test('a changed binding closes the menu and an ended session cannot be interrupted', async ({ page }) => {
  await identity(page, '801', 'ru');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const trigger = page.getByTestId(COMMAND_IDS.actionsTrigger);

  await expect(trigger).toHaveAttribute('aria-label', 'Действия сессии');
  await trigger.click();
  await expect(page.getByTestId(COMMAND_IDS.interrupt)).toBeVisible();

  await publishSnapshot((snapshot) => {
    snapshot.sessions[0]!.generation = 'replacement-generation';
    snapshot.sessions[0]!.status = 'ended';

    snapshot.permissions = snapshot.permissions.filter(
      (permission) => permission.sessionId !== 'terminal-session',
    );

    snapshot.terminal = null;
  });

  await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Завершена');
  await expect(page.getByTestId(COMMAND_IDS.interrupt)).toBeHidden();
  await trigger.click();
  await expect(page.getByTestId(COMMAND_IDS.interrupt)).toBeDisabled();
  expect(delivered).toHaveLength(0);
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  await expect(page.getByTestId(COMMAND_IDS.actionsPanel)).toBeHidden();
});
