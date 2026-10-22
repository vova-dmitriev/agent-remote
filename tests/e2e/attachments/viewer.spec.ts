import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import type { AttachmentDescriptor } from '@protocol';
import { test, delivered, publishMessages, deviceFixture } from '../support/relay/relay-fixture.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { UPLOAD_IDS } from '@/features/send-command/ui/attachments/test-ids.js';
import { ATTACHMENT_IDS } from '@/entities/attachment/config/test-ids.js';
import { setSessionLanguage } from '../support/ui/session-language.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { file, image, openAttachments, png } from './fixture.js';

test('authenticates image preview and file download without exposing bearer credentials in URLs', async ({
  page,
}) => {
  const imageRequests: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/attachments/')) imageRequests.push(request.url());
  });

  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles([image, file]);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.length).toBe(1);
  const action = delivered[0]!.action;

  if (action.type !== 'prompt' || !action.attachments) throw new Error('EXPECTED_ATTACHMENTS');
  expect(action.attachments).toHaveLength(2);
  expect(action.attachments[1]).toMatchObject({ kind: 'file', mimeType: 'application/json' });

  // The agent's record of the sent prompt replaces its echo in the feed.
  await publishMessages([
    {
      id: 'media-history',
      role: 'user',
      text: '',
      occurredAt: Date.now(),
      attachments: action.attachments,
    },
  ]);

  await expect(page.getByTestId(ATTACHMENT_IDS.image)).toBeVisible();
  await expect(page.getByTestId(ATTACHMENT_IDS.image)).toHaveAttribute('src', /^blob:/u);
  await page.getByTestId(ATTACHMENT_IDS.open).click();
  await expect(page.getByTestId(ATTACHMENT_IDS.dialog)).toBeVisible();
  await expect(page.getByTestId(ATTACHMENT_IDS.viewerImage)).toHaveAttribute('src', /^blob:/u);
  await page.getByTestId(ATTACHMENT_IDS.close).press('Escape');
  await expect(page.getByTestId(ATTACHMENT_IDS.dialog)).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');

  await page.getByTestId(ATTACHMENT_IDS.download).nth(1).click();
  const download = await downloadEvent;

  expect(download.suggestedFilename()).toBe(file.name);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];

  if (!stream) throw new Error('DOWNLOAD_UNAVAILABLE');
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(file.buffer);
  expect(imageRequests.every((url) => !url.includes('?') && !url.includes('token'))).toBe(true);
  await page.screenshot({ path: 'artifacts/attachments-mobile.png', fullPage: true });
});

test('shows a translated expired attachment and retries a transient image read failure', async ({ page }) => {
  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.length).toBe(1);
  const action = delivered[0]!.action;

  if (action.type !== 'prompt' || !action.attachments) throw new Error('EXPECTED_ATTACHMENT');
  await deviceFixture().relay.db.pool.query('UPDATE attachments SET expires_at=$1', [Date.now() - 1]);
  // The sent prompt's echo already showed the image; a fresh app reads the expired attachment anew.
  await page.reload();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  await publishMessages([
    {
      id: 'expired-image',
      role: 'assistant',
      text: '',
      occurredAt: Date.now(),
      attachments: action.attachments,
    },
  ]);

  await expect(page.getByTestId(ATTACHMENT_IDS.status)).toContainText('expired');
  await setSessionLanguage(page, 'ru', 'terminal-session');
  await expect(page.getByTestId(ATTACHMENT_IDS.status)).toContainText('истёк');
  await deviceFixture().relay.db.pool.query('UPDATE attachments SET expires_at=$1', [Date.now() + 60000]);
  await page.getByTestId(ATTACHMENT_IDS.retry).click();
  await expect(page.getByTestId(ATTACHMENT_IDS.image)).toBeVisible();
});

test('keeps media available in observation-only session history', async ({ page }) => {
  const { relay, deviceId } = deviceFixture();

  const owner = (await relay.db.pool.query('SELECT owner_id FROM devices WHERE id=$1', [deviceId])).rows[0]
    .owner_id as string;

  const descriptor: AttachmentDescriptor = await relay.attachments.store(
    { ownerId: owner, deviceId, sessionId: 'chat-session' },
    {
      uploadId: crypto.randomUUID(),
      generation: 'g',
      name: image.name,
      mimeType: image.mimeType,
      bytes: png,
    },
    true,
  );

  expect(descriptor.sha256).toBe(createHash('sha256').update(png).digest('hex'));
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[1]!.capabilities.prompt = false;
  deviceFixture().sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

  await publishMessages(
    [
      {
        id: 'observation-media',
        role: 'assistant',
        text: '',
        occurredAt: Date.now(),
        attachments: [descriptor],
      },
    ],
    'chat-session',
  );

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  await expect(page.getByTestId(UPLOAD_IDS.select)).toHaveCount(0);
  await expect(page.getByTestId(ATTACHMENT_IDS.image)).toBeVisible();
});
