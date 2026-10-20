import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

for (const language of ['en', 'ru'] as const) {
  test(`native mobile rows and concise conversation in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await publishMessages(
      [
        { id: 'mobile-question', role: 'user', text: 'Review the mobile layout.', occurredAt: Date.now() },
        {
          id: 'mobile-answer',
          role: 'assistant',
          text: 'The session list is clear.\n\nA compact header leaves more space for the conversation.',
          occurredAt: Date.now() + 1,
        },
      ],
      'chat-session',
    );

    await identity(page, '801', language);
    await page.goto('/');
    const cards = page.getByTestId(SESSION_CARD_IDS.root);

    await expect(cards).toHaveCount(4);

    for (const card of await cards.all()) {
      await expect(card).toHaveCSS('border-top-width', '0px');
      await expect(card).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect((await card.boundingBox())!.height).toBeLessThanOrEqual(76);
      await expect(card.getByTestId(SESSION_CARD_IDS.title)).toBeVisible();
      await expect(card.getByTestId(SESSION_CARD_IDS.status)).toBeVisible();
    }

    if (language === 'en') await page.screenshot({ path: 'artifacts/mobile-codex-sessions.png' });
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
    const feed = page.getByTestId(SESSION_FEED_IDS.root);
    const composer = page.getByTestId(COMMAND_IDS.root);
    const prompt = page.getByTestId(COMMAND_IDS.prompt);
    const answer = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'mobile-answer' });
    const question = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'mobile-question' });

    await expect(answer).toBeVisible();
    await expect(page.getByTestId(SESSION_PAGE_IDS.history)).toHaveCount(0);
    await expect(page.getByTestId(SESSION_PAGE_IDS.terminal)).toHaveCount(0);
    expect((await feed.boundingBox())!.y).toBeLessThanOrEqual(145);
    expect((await feed.boundingBox())!.height).toBeGreaterThan(550);
    await expect(answer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(answer.getByTestId(SESSION_FEED_IDS.text)).toHaveCSS('font-size', '15px');
    await expect(question).toHaveCSS('border-radius', '20px');
    await expect(question).toHaveAttribute('aria-label', language === 'en' ? 'You' : 'Ты');
    expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(105);
    const promptBox = (await page.getByTestId(COMMAND_IDS.promptFrame).boundingBox())!;
    const sendBox = (await page.getByTestId(COMMAND_IDS.send).boundingBox())!;

    expect(sendBox.y).toBeGreaterThanOrEqual(promptBox.y);
    expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(promptBox.y + promptBox.height + 1);
    await prompt.fill('A synthetic draft');
    await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();

    if (language === 'en') await page.screenshot({ path: 'artifacts/mobile-codex-chat.png' });

    for (const height of [844, 400]) {
      await page.setViewportSize({ width: 390, height });
      await expect(prompt).toBeInViewport();
      await expect(page.getByTestId(COMMAND_IDS.actionsTrigger)).toBeInViewport();
      expect((await feed.boundingBox())!.height).toBeGreaterThan(130);

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);

      expect(
        await page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
      ).toBeLessThanOrEqual(1);
    }

    await page.getByTestId(SESSION_PAGE_IDS.back).click();
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
    await expect(page.getByTestId(SESSION_PAGE_IDS.history)).toBeVisible();
    await expect(page.getByTestId(SESSION_PAGE_IDS.terminal)).toBeVisible();
  });
}

test('dark mobile conversation preserves a neutral user bubble and readable text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await identity(page, '801', 'en');

  await publishMessages(
    [
      { id: 'dark-user', role: 'user', text: 'Synthetic dark theme question.', occurredAt: Date.now() },
      {
        id: 'dark-answer',
        role: 'assistant',
        text: 'Synthetic dark theme answer.',
        occurredAt: Date.now() + 1,
      },
    ],
    'chat-session',
  );

  await page.goto('/');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  const user = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'dark-user' });
  const answer = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'dark-answer' });

  await expect(user).toBeVisible();
  await expect(answer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  const colors = await user.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
  }));

  expect(colors.background).toBe('rgb(32, 36, 43)');
  expect(colors.color).toBe('rgb(232, 237, 244)');
  await page.screenshot({ path: 'artifacts/mobile-codex-chat-dark.png' });
});
