import { SESSION_AVAILABILITY_IDS } from '../../apps/mini-app/src/entities/session/config/availability-test-ids.js';
import { expect } from '@playwright/test';
import { test, publishMessages } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { SESSIONS_PAGE_IDS } from '../../apps/mini-app/src/pages/sessions/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';
import { LANGUAGE_SWITCHER_IDS } from '../../apps/mini-app/src/shared/ui/test-ids.js';

test('selected chat gives the mobile viewport to history and keeps the composer compact', async ({
  page,
}) => {
  await publishMessages(
    [
      { id: 'compact-user', role: 'user', text: 'A short question.', occurredAt: Date.now() },
      {
        id: 'compact-answer',
        role: 'assistant',
        text: 'A concise synthetic answer.',
        occurredAt: Date.now() + 1,
      },
    ],
    'chat-session',
  );

  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  const feed = page.getByTestId(SESSION_FEED_IDS.root);
  const prompt = page.getByTestId(COMMAND_IDS.prompt);

  await expect(page.getByTestId(SESSION_FEED_IDS.message)).toHaveCount(2);
  await expect(page.getByTestId(SHELL_IDS.home)).toHaveCount(0);
  const backBox = (await page.getByTestId(SESSION_PAGE_IDS.back).boundingBox())!;
  const connectionBox = (await page.getByTestId(SESSION_AVAILABILITY_IDS.trigger).boundingBox())!;
  const actionsBox = (await page.getByTestId(COMMAND_IDS.actionsTrigger).boundingBox())!;

  expect(backBox.y).toBeLessThan(24);

  expect(
    Math.abs(connectionBox.y + connectionBox.height / 2 - actionsBox.y - actionsBox.height / 2),
  ).toBeLessThanOrEqual(2);

  await expect(page.getByTestId(SESSION_AVAILABILITY_IDS.trigger)).toHaveAttribute(
    'aria-label',
    'Сессия онлайн',
  );

  const viewport = page.viewportSize()!;

  expect((await feed.boundingBox())!.height).toBeGreaterThan(viewport.height / 2);
  expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(70);

  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBeLessThanOrEqual(1);

  const user = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'compact-user' });

  expect((await user.boundingBox())!.width).toBeLessThan((await feed.boundingBox())!.width * 0.9);
  await expect(page.getByTestId(SHELL_IDS.logout)).toHaveCount(0);
  await expect(page.getByTestId(LANGUAGE_SWITCHER_IDS.en)).toHaveCount(0);
  await prompt.fill('Draft remains while navigating');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await expect(page.getByTestId(SHELL_IDS.home)).toBeVisible();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  await expect(prompt).toHaveValue('Draft remains while navigating');
  await prompt.fill('One line\nTwo lines\nThree lines\nFour lines\nFive lines');
  expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(100);
  await prompt.fill('');
  expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(70);
  await page.setViewportSize({ width: viewport.width, height: 400 });
  await expect(prompt).toBeInViewport();
  expect((await feed.boundingBox())!.height).toBeGreaterThan(100);

  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBeLessThanOrEqual(1);

  await page.setViewportSize(viewport);
  await page.screenshot({ path: 'artifacts/chat-compact-mobile.png', fullPage: true });
});

for (const language of ['ru', 'en'] as const) {
  test(`home keeps controls in one header and sessions compact in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await identity(page, '801', language);
    await page.goto('/');
    const cards = page.getByTestId(SESSION_CARD_IDS.root);
    const connection = page.getByTestId(SHELL_IDS.connection);
    const logout = page.getByTestId(SHELL_IDS.logout);
    const languages = page.getByTestId(LANGUAGE_SWITCHER_IDS.root);

    await expect(cards).toHaveCount(4);
    const connectionBox = (await connection.boundingBox())!;

    for (const control of [logout, languages]) {
      const box = (await control.boundingBox())!;

      expect(
        Math.abs(box.y + box.height / 2 - connectionBox.y - connectionBox.height / 2),
      ).toBeLessThanOrEqual(2);
    }

    expect((await cards.first().boundingBox())!.y).toBeLessThanOrEqual(160);

    for (const card of await cards.all()) {
      const box = (await card.boundingBox())!;

      expect(box.height).toBeLessThanOrEqual(76);
      expect(box.height).toBeGreaterThanOrEqual(64);
      await expect(card.getByTestId(SESSION_CARD_IDS.title)).toBeVisible();
      await expect(card.getByTestId(SESSION_CARD_IDS.status)).toBeVisible();
    }

    await expect(page.getByTestId(SESSIONS_PAGE_IDS.title)).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `artifacts/home-compact-${language}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 400 });
    await expect(cards.nth(2)).toBeInViewport({ ratio: 1 });
    await expect(logout).toBeInViewport({ ratio: 1 });
    await expect(languages).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `artifacts/home-compact-${language}-short.png` });
  });
}
