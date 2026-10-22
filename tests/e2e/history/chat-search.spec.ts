import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { expectLoadedMessages, railConversation } from '../support/ui/rail.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { CHAT_SEARCH_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';

test('searches the whole chat from the session menu and goes to a match outside the loaded window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const messages = railConversation(300);

  messages[7] = { ...messages[7]!, text: 'Синтетический ДЕПЛОЙ на виртуальную машину' };
  messages[280] = { ...messages[280]!, text: 'Повторный деплой после правки' };
  await publishMessages(messages);
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expectLoadedMessages(page, 100);

  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await page.getByTestId(CHAT_SEARCH_IDS.open).click();
  await page.getByTestId(CHAT_SEARCH_IDS.input).fill('деплой');

  // Newest first; the words are marked whatever their case.
  const results = page.getByTestId(CHAT_SEARCH_IDS.result);

  await expect(results).toHaveCount(2);
  await expect(results.first()).toHaveAttribute('data-message-id', 'rail-280');
  await expect(results.nth(1).getByTestId(CHAT_SEARCH_IDS.match)).toHaveText('ДЕПЛОЙ');

  await results.nth(1).click();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'rail-7' })).toBeInViewport();

  await page.getByTestId(CHAT_SEARCH_IDS.input).fill('nothing like this');
  await expect(page.getByTestId(CHAT_SEARCH_IDS.empty)).toBeVisible();
  await page.getByTestId(CHAT_SEARCH_IDS.input).press('Escape');
  await expect(page.getByTestId(CHAT_SEARCH_IDS.root)).toHaveCount(0);
});
