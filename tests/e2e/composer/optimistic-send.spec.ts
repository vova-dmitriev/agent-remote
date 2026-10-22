import { expect } from '@playwright/test';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { test, delivered, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';

test('a sent prompt shows in the feed at once and gives way to the agent record of it', async ({ page }) => {
  await publishMessages([{ id: 'answer', role: 'assistant', text: 'Earlier synthetic answer', occurredAt: 1700000000000 }]);
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.message)).toHaveCount(1);

  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));

  await page.route('**/commands', async (route) => {
    await held;
    await route.continue();
  });

  await page.getByTestId(COMMAND_IDS.prompt).fill('Optimistic synthetic instruction');
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');

  // Still on its way to the relay, the prompt is already in the feed, dimmed.
  const pending = byTestId(page, SESSION_FEED_IDS.virtualRow, { pending: "true" });

  await expect(pending).toContainText('Optimistic synthetic instruction');
  await expect(page.getByTestId(COMMAND_IDS.queue)).toHaveCount(0);
  release();
  await expect.poll(() => delivered.length).toBe(1);
  await expect(pending).toHaveCount(1);
  await expect(page.getByTestId(COMMAND_IDS.queue)).toHaveCount(0);

  await publishMessages([{ id: 'recorded', role: 'user', text: 'Optimistic synthetic instruction', occurredAt: 1700000001000 }]);
  await expect(pending).toHaveCount(0);
  await expect(page.getByTestId(SESSION_FEED_IDS.message).filter({ hasText: 'Optimistic synthetic instruction' })).toHaveCount(1);
});
