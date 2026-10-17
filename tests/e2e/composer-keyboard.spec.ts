import { expect } from '@playwright/test';
import { test, delivered, setCommandOutcome } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';

test('Enter sends once; Shift+Enter inserts a line break; composition never submits', async ({ page }) => {
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const prompt = page.getByTestId(COMMAND_IDS.prompt);

  await prompt.fill('First line');
  await prompt.press('Shift+Enter');
  await prompt.press('End');
  await prompt.press('a');
  await expect(prompt).toHaveValue('First line\na');
  await prompt.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await prompt.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 });
  expect(delivered).toHaveLength(0);
  setCommandOutcome('held');
  await prompt.press('Enter');
  await expect.poll(() => delivered.length).toBe(1);
  expect(delivered[0]!.action).toEqual({ type: 'prompt', text: 'First line\na' });
  await prompt.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true });
  expect(delivered).toHaveLength(1);
});
