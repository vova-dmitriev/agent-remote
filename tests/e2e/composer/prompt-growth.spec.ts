import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

test('the prompt grows with its lines up to six, then scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  const prompt = page.getByTestId(COMMAND_IDS.prompt);
  const height = async () => (await prompt.boundingBox())!.height;

  await prompt.fill('One line');
  const one = await height();

  await prompt.fill('First\nSecond\nThird');
  const three = await height();

  expect(three).toBeGreaterThanOrEqual(one * 2.5);

  await prompt.fill(Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join('\n'));
  const many = await height();

  expect(many).toBeLessThanOrEqual(one * 6 + 1);
  expect(many).toBeGreaterThan(three);
  expect(await prompt.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);

  // Back to one line, the prompt shrinks again.
  await prompt.fill('Short');
  expect(await height()).toBeLessThanOrEqual(one + 1);
});
