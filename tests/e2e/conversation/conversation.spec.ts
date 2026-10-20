import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { conversation } from '../support/fixtures/conversation-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { expectLoadedMessages, railMarker } from '../support/ui/rail.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { MARKDOWN_IDS } from '@/shared/ui/markdown/test-ids.js';
import { setSessionLanguage } from '../support/ui/session-language.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

test('message rail jumps within the feed, preserves reading position and resumes following at bottom', async ({
  page,
}) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await publishMessages(conversation);
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expectLoadedMessages(page, 35);

  await expect
    .poll(() => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(5);

  await page.getByTestId(COMMAND_IDS.prompt).fill('Keep this draft');
  const top = page.getByTestId(SESSION_FEED_IDS.marker).first();

  await expect(top).toHaveAttribute('data-message-id', 'navigation-0');

  await top.click();
  await expect.poll(() => feed.evaluate((node) => node.scrollTop)).toBeLessThan(5);
  await expect(top).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId(SESSION_FEED_IDS.bottom)).toBeVisible();

  await publishMessages([
    { id: 'new-arrival', role: 'assistant', text: 'New synthetic arrival', occurredAt: Date.now() },
  ]);

  await expectLoadedMessages(page, 36);
  await expect.poll(() => feed.evaluate((node) => node.scrollTop)).toBeLessThan(5);
  await top.press('ArrowDown');
  await expect(page.getByTestId(SESSION_FEED_IDS.marker).nth(1)).toBeFocused();
  await page.getByTestId(SESSION_FEED_IDS.bottom).click();

  await expect
    .poll(() => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(5);

  await expect(page.getByTestId(SESSION_FEED_IDS.bottom)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Keep this draft');

  await publishMessages([
    {
      id: 'following-arrival',
      role: 'assistant',
      text: 'Following resumed. '.repeat(100),
      occurredAt: Date.now() + 1,
    },
  ]);

  await expectLoadedMessages(page, 37);

  await expect
    .poll(() => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(5);

  await page.getByTestId(SESSION_PAGE_IDS.terminal).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.rail)).toHaveCount(0);
  await page.getByTestId(SESSION_PAGE_IDS.history).click();

  await expect
    .poll(() => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(5);

  await page.screenshot({ path: 'artifacts/chat-navigation-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Markdown is safe, code copies exactly and localized controls follow language changes', async ({
  page,
}) => {
  let remoteImageRequests = 0;

  page.on('request', (request) => {
    if (request.url().startsWith('https://images.invalid/')) remoteImageRequests++;
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('synthetic-clipboard', text);
        },
      },
    });
  });

  await publishMessages(conversation);
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await railMarker(page, 'navigation-1').click();
  const message = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'navigation-1' });

  await expect(message.getByTestId(MARKDOWN_IDS.codeBlock)).toHaveAttribute('data-language', 'typescript');
  await expect(message.getByTestId(MARKDOWN_IDS.root)).toContainText('Formatted text');
  const code = message.getByTestId(MARKDOWN_IDS.code);

  await message.getByTestId(MARKDOWN_IDS.copyCode).click();

  expect(await page.evaluate(() => sessionStorage.getItem('synthetic-clipboard'))).toBe(
    await code.textContent(),
  );

  await expect(message.getByTestId(MARKDOWN_IDS.copyStatus)).toHaveText('Скопировано');
  await setSessionLanguage(page, 'en', 'terminal-session');
  await railMarker(page, 'navigation-1').click();
  await message.getByTestId(MARKDOWN_IDS.copyCode).click();
  await expect(message.getByTestId(MARKDOWN_IDS.copyStatus)).toHaveText('Copied');
  expect(await page.evaluate(() => Reflect.get(window, 'markdownExecuted'))).toBeUndefined();
  expect(remoteImageRequests).toBe(0);
  await page.screenshot({ path: 'artifacts/chat-markdown-mobile.png', fullPage: true });

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
  });

  await message.getByTestId(MARKDOWN_IDS.copyCode).click();
  await expect(message.getByTestId(MARKDOWN_IDS.copyStatus)).toHaveText('Copy failed');
});
