import { expect, type Page } from '@playwright/test';
import { FrameType, SessionStatus, CommandActionType, AttachmentMode, type SessionStatus as SourceStatus } from '../../packages/protocol/src/index.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { UPLOAD_IDS } from '../../apps/mini-app/src/features/send-command/ui/attachments/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { test, delivered, deviceFixture } from './support/relay-fixture.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';

async function sourceStatus(status: SourceStatus, attachments = false) {
  const { sockets, deviceId, relay } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[0]!.status = status;
  if (attachments) snapshot.sessions[0]!.capabilities.attachments = { images: AttachmentMode.Reference, files: AttachmentMode.Reference };
  sockets[0]!.send(JSON.stringify({ type: FrameType.Snapshot, snapshot, connectors: [] }));
  await expect.poll(async () => (await relay.db.pool.query("SELECT data->>'status' AS status FROM sessions WHERE id='terminal-session'")).rows[0]?.status).toBe(status);
}

async function openQueue(page: Page, attachments = false) {
  await sourceStatus(SessionStatus.Running, attachments);
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Running');
}

async function enqueue(page: Page, text: string) {
  await page.getByTestId(COMMAND_IDS.prompt).fill(text);
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
}

test('edits the first queued prompt and sends the selected second prompt immediately while the source is busy', async ({ page }) => {
  await openQueue(page);
  await enqueue(page, 'First queued instruction');
  await enqueue(page, 'Second queued instruction');
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(2);
  await page.getByTestId(COMMAND_IDS.prompt).fill('Keep this separate composer draft');
  const firstId = await page.getByTestId(COMMAND_IDS.queuedItem).nth(0).getAttribute('data-command-id');
  const secondId = await page.getByTestId(COMMAND_IDS.queuedItem).nth(1).getAttribute('data-command-id');

  await page.getByTestId(COMMAND_IDS.editQueued).nth(0).click();
  await expect(page.getByTestId(COMMAND_IDS.queuedEditorText)).toHaveValue('First queued instruction');
  await page.getByTestId(COMMAND_IDS.queuedEditorText).fill('Edited first instruction');
  await page.screenshot({ path: 'artifacts/queue-edit-mobile.png', fullPage: true });
  await page.getByTestId(COMMAND_IDS.saveQueuedEdit).click();
  await expect(page.getByTestId(COMMAND_IDS.queuedText).nth(0)).toHaveText('Edited first instruction');
  await page.getByTestId(COMMAND_IDS.sendQueuedNow).nth(1).click();
  await expect.poll(() => delivered.length).toBe(1);
  expect(delivered[0]).toMatchObject({ commandId: secondId, action: { type: CommandActionType.Prompt, text: 'Second queued instruction' } });
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('Edited first instruction');
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Keep this separate composer draft');
  await sourceStatus(SessionStatus.Idle);
  await expect.poll(() => delivered.length).toBe(2);
  expect(delivered[1]).toMatchObject({ commandId: firstId, action: { type: CommandActionType.Prompt, text: 'Edited first instruction' } });
  await expect(page.getByTestId(COMMAND_IDS.queue)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Keep this separate composer draft');
});

test('holds automatic delivery while editing and cancel restores the original queued prompt', async ({ page }) => {
  await openQueue(page);
  await enqueue(page, 'Original queued instruction');
  await page.getByTestId(COMMAND_IDS.prompt).fill('Untouched composer draft');
  await page.getByTestId(COMMAND_IDS.editQueued).click();
  await page.getByTestId(COMMAND_IDS.queuedEditorText).fill('');
  await page.getByTestId(COMMAND_IDS.saveQueuedEdit).click();
  await expect(page.getByTestId(COMMAND_IDS.queuedEditError)).toBeVisible();
  await expect(page.getByTestId(COMMAND_IDS.queuedEditorText)).toHaveValue('');
  await page.getByTestId(COMMAND_IDS.queuedEditorText).fill('Discard this edit');
  await sourceStatus(SessionStatus.Idle);
  await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Ready for a message');
  await expect(page.getByTestId(COMMAND_IDS.queuedEditorText)).toHaveValue('Discard this edit');
  expect(delivered).toHaveLength(0);
  await page.getByTestId(COMMAND_IDS.cancelQueuedEdit).click();
  await expect.poll(() => delivered.length).toBe(1);
  expect(delivered[0]!.action).toMatchObject({ type: CommandActionType.Prompt, text: 'Original queued instruction' });
  await expect(page.getByTestId(COMMAND_IDS.queue)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Untouched composer draft');
});

test('preserves queued attachment identity when editing while a separate composer attachment draft remains unchanged', async ({ page }) => {
  await openQueue(page, true);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles({ name: 'queued.json', mimeType: 'application/json', buffer: Buffer.from('{"queued":true}') });
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  const queuedAttachmentId = await page.getByTestId(UPLOAD_IDS.pending).getAttribute('data-upload-id');

  await enqueue(page, 'Queued text with file');
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveAttribute('data-attachment-ids', JSON.stringify([queuedAttachmentId]));
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Separate composer attachment') });
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  const draftAttachmentId = await page.getByTestId(UPLOAD_IDS.pending).getAttribute('data-upload-id');

  await page.getByTestId(COMMAND_IDS.prompt).fill('Separate composer text');
  await page.getByTestId(COMMAND_IDS.editQueued).click();
  await page.getByTestId(COMMAND_IDS.queuedEditorText).fill('Edited queued text with file');
  await page.getByTestId(COMMAND_IDS.saveQueuedEdit).click();
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('Edited queued text with file');
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveAttribute('data-attachment-ids', JSON.stringify([queuedAttachmentId]));
  await page.getByTestId(COMMAND_IDS.sendQueuedNow).click();
  await expect.poll(() => delivered.length).toBe(1);
  expect(delivered[0]!.action).toMatchObject({ type: CommandActionType.Prompt, text: 'Edited queued text with file', attachments: [{ id: queuedAttachmentId, name: 'queued.json' }] });
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveAttribute('data-upload-id', draftAttachmentId!);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Separate composer text');
  await expect(page.getByTestId(COMMAND_IDS.queue)).toHaveCount(0);
});
