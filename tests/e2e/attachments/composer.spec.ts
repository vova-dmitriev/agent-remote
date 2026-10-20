import { expect } from '@playwright/test';
import { test, delivered, deviceFixture } from '../support/relay-fixture.js';
import { sessionSnapshot } from '../support/session-fixtures.js';
import { identity } from '../support/identity.js';
import { byTestId } from '../support/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { UPLOAD_IDS } from '@/features/send-command/ui/attachments/test-ids.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=',
  'base64',
);

test('uploads, removes and sends an image-only prompt through the real relay', async ({ page }) => {
  const { sockets, deviceId } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[0]!.capabilities.attachments = { images: 'reference', files: 'reference' };
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(UPLOAD_IDS.select)).toBeVisible();

  await page
    .getByTestId(UPLOAD_IDS.input)
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });

  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(1);
  await page.getByTestId(UPLOAD_IDS.remove).click();
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();

  await page
    .getByTestId(UPLOAD_IDS.input)
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });

  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.length).toBe(1);
  const command = delivered[0]!;

  expect(command.action.type).toBe('prompt');

  if (command.action.type !== 'prompt') throw new Error('EXPECTED_PROMPT');
  expect(command.action.text).toBe('');

  expect(command.action.attachments).toMatchObject([
    { name: 'synthetic.png', kind: 'image', byteLength: png.length },
  ]);

  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
});
