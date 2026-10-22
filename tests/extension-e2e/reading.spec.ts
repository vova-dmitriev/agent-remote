import { expect } from '@playwright/test';
import { test, selectSession } from './fixture.js';
import { byTestId } from '../e2e/support/ui/testid.js';
import { jumpNear, railMarker } from '../e2e/support/ui/rail.js';
import { CHAT_SEARCH_IDS, SESSION_PAGE_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { EventType, MessageRole } from '@protocol';
import { LocalDocumentKind } from '@daemon/local/state/values.js';

test('restores a middle message and active marker in a new extension viewer', async ({ extension }) => {
  for (let i = 0; i < 80; i++) {
    extension.runtime.monitor.publish(extension.runtime.session.id, EventType.Message, {
      id: 'reading-' + i,
      // Every other message is the owner's, which the rail marks.
      role: i % 2 ? MessageRole.Assistant : MessageRole.User,
      text: ('Synthetic paragraph ' + i + '\n\n').repeat(8),
      occurredAt: 1700000000000 + i,
    });
  }

  const page = await extension.open();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectSession(page);
  // The rail marks every owner's message the companion holds, beyond the loaded window too.
  await expect(page.getByTestId(SESSION_FEED_IDS.rail)).toHaveAttribute('data-marker-count', '40');
  const target = await jumpNear(page, 'reading-60');

  await expect(railMarker(page, target)).toHaveAttribute('aria-current', 'true');
  const row = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': target });
  const before = await row.evaluate((element) => element.getBoundingClientRect().top);

  await page.getByTestId(SESSION_PAGE_IDS.back).click();

  await expect
    .poll(
      () =>
        extension.runtime.controller.options.documents.get(
          'owner-local',
          extension.runtime.session.id,
          LocalDocumentKind.Reading,
        ).value,
    )
    .toMatchObject({ messageId: target });

  await page.close();
  const reopened = await extension.open();

  await reopened.emulateMedia({ reducedMotion: 'reduce' });
  await selectSession(reopened);
  const restored = byTestId(reopened, SESSION_FEED_IDS.virtualRow, { 'message-id': target });

  await expect(restored).toBeVisible();

  await expect
    .poll(async () =>
      Math.abs((await restored.evaluate((element) => element.getBoundingClientRect().top)) - before),
    )
    .toBeLessThan(3);

  await expect(railMarker(reopened, target)).toHaveAttribute('aria-current', 'true');

  await reopened.getByTestId(SESSION_FEED_IDS.bottom).click();

  await expect(reopened.getByTestId(SESSION_FEED_IDS.rail)).toHaveAttribute(
    'data-active-message-id',
    'reading-78',
  );
});

test('searches the whole chat through the companion and goes to a match outside the loaded window', async ({
  extension,
}) => {
  for (let i = 0; i < 80; i++) {
    extension.runtime.monitor.publish(extension.runtime.session.id, EventType.Message, {
      id: 'searching-' + i,
      role: i % 2 ? MessageRole.Assistant : MessageRole.User,
      text: i === 5 ? 'Синтетический ДЕПЛОЙ на виртуальную машину' : 'Synthetic paragraph ' + i,
      occurredAt: 1700000000000 + i,
    });
  }

  const page = await extension.open();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectSession(page);
  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await page.getByTestId(CHAT_SEARCH_IDS.open).click();
  await page.getByTestId(CHAT_SEARCH_IDS.input).fill('деплой');
  await expect(page.getByTestId(CHAT_SEARCH_IDS.result)).toHaveCount(1);
  await page.getByTestId(CHAT_SEARCH_IDS.result).click();
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'searching-5' })).toBeInViewport();
});
