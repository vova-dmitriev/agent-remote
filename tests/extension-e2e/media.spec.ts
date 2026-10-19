import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { test, selectSession } from './fixture.js';
import { syntheticImageBytes } from '../../apps/mini-app/.storybook/fixtures/attachment/media.js';
import { UPLOAD_IDS } from '../../apps/mini-app/src/features/send-command/ui/attachments/test-ids.js';
import { ATTACHMENT_IDS } from '../../apps/mini-app/src/entities/attachment/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { LocalDocumentKind } from '../../apps/daemon/src/local/state/values.js';
import { EventType, MessageRole, type AttachmentDescriptor } from '@protocol';

test('restores an acknowledged image draft and opens, zooms and downloads original bytes', async ({
  extension,
}) => {
  const bytes = Buffer.from(syntheticImageBytes());
  const page = await extension.open();

  await selectSession(page);

  await page
    .getByTestId(UPLOAD_IDS.input)
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: bytes });

  await expect(page.getByTestId(UPLOAD_IDS.status)).toHaveText('Ready to send');

  const draft = () =>
    extension.runtime.controller.options.documents.get(
      'owner-local',
      extension.runtime.session.id,
      LocalDocumentKind.Draft,
    ).value as { attachments: AttachmentDescriptor[] } | null;

  await expect.poll(() => draft()?.attachments.length).toBe(1);
  const attachment = draft()!.attachments[0]!;

  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await page.close();
  const reopened = await extension.open();

  await selectSession(reopened);
  await expect(reopened.getByTestId(UPLOAD_IDS.status)).toHaveText('Ready to send');
  await expect(reopened.getByTestId(UPLOAD_IDS.image)).toHaveJSProperty('naturalWidth', 320);

  extension.runtime.monitor.publish(extension.runtime.session.id, EventType.Message, {
    id: 'synthetic-image-message',
    role: MessageRole.User,
    text: 'Synthetic attachment',
    occurredAt: Date.now(),
    attachments: [attachment],
  });

  await reopened.getByTestId(ATTACHMENT_IDS.open).click();
  await expect(reopened.getByTestId(ATTACHMENT_IDS.viewerImage)).toHaveAttribute('src', /^blob:/);
  await reopened.getByTestId(ATTACHMENT_IDS.zoomIn).click();
  await expect(reopened.getByTestId(ATTACHMENT_IDS.zoom)).toHaveText('125%');
  await reopened.getByTestId(ATTACHMENT_IDS.original).click();
  await expect(reopened.getByTestId(ATTACHMENT_IDS.zoom)).toHaveText('100%');
  const downloading = reopened.waitForEvent('download');

  await reopened.getByTestId(ATTACHMENT_IDS.viewerDownload).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];

  if (!stream) {
    throw new Error('Synthetic download unavailable');
  }

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(attachment.sha256);
  await reopened.getByTestId(ATTACHMENT_IDS.close).click();
  await expect(reopened.getByTestId(ATTACHMENT_IDS.dialog)).toHaveCount(0);
});
