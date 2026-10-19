import { expect } from '@playwright/test';
import { test, selectSession } from './fixture.js';
import { byTestId } from '../e2e/support/testid.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { EventType, MessageRole } from '@protocol';
import { LocalDocumentKind } from '../../apps/daemon/src/local/state/values.js';

test('restores a middle message and active marker in a new extension viewer', async ({ extension }) => {
  for (let i = 0; i < 80; i++) {
    extension.runtime.monitor.publish(extension.runtime.session.id, EventType.Message, {
      id: 'reading-' + i,
      role: MessageRole.Assistant,
      text: ('Synthetic paragraph ' + i + '\n\n').repeat(8),
      occurredAt: 1700000000000 + i,
    });
  }

  const page = await extension.open();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectSession(page);
  const marker = byTestId(page, SESSION_FEED_IDS.marker, { 'message-id': 'reading-60' });

  await marker.click();
  await expect(marker).toHaveAttribute('aria-current', 'true');
  const row = byTestId(page, SESSION_FEED_IDS.virtualRow, { 'message-id': 'reading-60' });
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
    .toMatchObject({ messageId: 'reading-60' });

  await page.close();
  const reopened = await extension.open();

  await reopened.emulateMedia({ reducedMotion: 'reduce' });
  await selectSession(reopened);
  const restored = byTestId(reopened, SESSION_FEED_IDS.virtualRow, { 'message-id': 'reading-60' });

  await expect(restored).toBeVisible();

  await expect
    .poll(async () =>
      Math.abs((await restored.evaluate((element) => element.getBoundingClientRect().top)) - before),
    )
    .toBeLessThan(3);

  await expect(byTestId(reopened, SESSION_FEED_IDS.marker, { 'message-id': 'reading-60' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  await reopened.getByTestId(SESSION_FEED_IDS.bottom).click();

  await expect(byTestId(reopened, SESSION_FEED_IDS.marker, { 'message-id': 'reading-79' })).toHaveAttribute(
    'aria-current',
    'true',
  );
});
