import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';

test('a long message folds to its first lines and unfolds again; a short one has nothing to fold', async ({
  page,
}) => {
  const long = Array.from({ length: 40 }, (_, line) => `Synthetic line ${line + 1}.`).join('\n\n');

  await publishMessages(
    [
      { id: 'fold-short', role: 'user', text: 'A short question.', occurredAt: Date.now() },
      { id: 'fold-long', role: 'assistant', text: long, occurredAt: Date.now() + 1 },
    ],
    'chat-session',
  );

  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();

  const short = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'fold-short' });
  const answer = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'fold-long' });
  const text = answer.getByTestId(SESSION_FEED_IDS.text);
  const fold = answer.getByTestId(SESSION_FEED_IDS.fold);

  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(short.getByTestId(SESSION_FEED_IDS.fold)).toHaveCount(0);
  const unfolded = (await text.boundingBox())!.height;

  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(text).toHaveAttribute('data-collapsed', 'true');
  expect((await text.boundingBox())!.height).toBeLessThanOrEqual(168);

  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await text.boundingBox())!.height).toBe(unfolded);
});
