import { expect } from '@playwright/test';
import type { ClientCommand } from '@protocol';
import { test, delivered, setCommandOutcome } from '../support/relay/relay-fixture.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { UPLOAD_IDS } from '@/features/send-command/ui/attachments/test-ids.js';
import { releaseCommandOutcome } from '../runtime/command-outcome.js';
import { image, openAttachments } from './fixture.js';
import { interruptSession } from '../support/ui/session-actions.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { ATTACHMENT_IDS } from '@/entities/attachment/config/test-ids.js';

test('retries an upload with its original ID after an ambiguous response', async ({ page }) => {
  const ids: string[] = [];

  await page.route('**/sessions/*/attachments', async (route) => {
    ids.push(route.request().headers()['x-upload-id']!);

    if (ids.length === 1) {
      await route.fetch();
      await route.abort('connectionfailed');
    } else await route.continue();
  });

  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(UPLOAD_IDS.retry)).toBeVisible();
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
  await page.getByTestId(UPLOAD_IDS.retry).click();
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.length).toBe(1);
});

test('retains the exact command and attachment IDs until uncertain delivery is resolved', async ({
  page,
}) => {
  const commands: ClientCommand[] = [];
  let statusAvailable = false;

  setCommandOutcome('held');

  await page.route('**/commands', async (route) => {
    commands.push(route.request().postDataJSON() as ClientCommand);
    await route.fetch();
    await route.abort('connectionfailed');
  });

  let released = false;

  await page.route('**/commands/*', async (route) => {
    if (statusAvailable) {
      // Status polls continue after the release; the outcome is released once.
      if (!released) {
        released = true;
        await releaseCommandOutcome();
      }

      await route.continue();
    } else await route.abort('connectionfailed');
  });

  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  const uploadId = await page.getByTestId(UPLOAD_IDS.pending).getAttribute('data-upload-id');

  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeVisible();
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveAttribute('data-attachment-ids', JSON.stringify([uploadId!]));
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  await expect(page.getByTestId(UPLOAD_IDS.select)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
  expect(commands).toHaveLength(1);
  statusAvailable = true;
  await page.getByTestId(COMMAND_IDS.retryQueued).click();
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toMatchObject(commands[0]!);
  // The page keeps polling the command status; stop handling it before the relay shuts down.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('retains original attachment and command IDs when the source reports an explicit unknown outcome', async ({
  page,
}) => {
  const posts: ClientCommand[] = [];
  const lookups: string[] = [];

  setCommandOutcome('unknown');

  page.on('request', (request) => {
    if (request.url().endsWith('/commands') && request.method() === 'POST')
      posts.push(request.postDataJSON() as ClientCommand);
    if (request.url().includes('/commands/') && request.method() === 'GET') lookups.push(request.url());
  });

  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  const uploadId = await page.getByTestId(UPLOAD_IDS.pending).getAttribute('data-upload-id');

  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeVisible();
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  await expect(page.getByTestId(UPLOAD_IDS.select)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
  await page.getByTestId(COMMAND_IDS.retryQueued).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.retryQueued).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveAttribute('data-attachment-ids', JSON.stringify([uploadId!]));
  expect(posts).toHaveLength(1);
  expect(delivered).toHaveLength(1);
  expect(lookups).toHaveLength(2);
  expect(lookups.every((url) => url.endsWith(posts[0]!.commandId))).toBe(true);
});

test('clears uncertainty when a delayed source receipt arrives without another HTTP request', async ({
  page,
}) => {
  setCommandOutcome('held');

  await page.route('**/commands', async (route) => {
    await route.fetch();
    await route.abort('connectionfailed');
  });

  await page.route('**/commands/*', (route) => route.abort('connectionfailed'));
  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeVisible();
  await releaseCommandOutcome();
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toHaveCount(0);
  expect(delivered).toHaveLength(1);
});

test('does not confuse a pending interrupt with an unsent attachment prompt', async ({ page }) => {
  setCommandOutcome('held');
  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic next prompt');
  await interruptSession(page);
  await expect.poll(() => delivered.length).toBe(1);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toHaveCount(0);
  await releaseCommandOutcome();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toHaveCount(0);
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(1);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Synthetic next prompt');
  setCommandOutcome('dispatched');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.length).toBe(2);
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
});

test('shows an accepted prompt with its attachment in the feed while a new draft remains editable', async ({ page }) => {
  setCommandOutcome('held');
  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  const originalId = await page.getByTestId(UPLOAD_IDS.pending).getAttribute('data-upload-id');

  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.length).toBe(1);
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  await expect(page.getByTestId(UPLOAD_IDS.select)).toBeEnabled();
  await expect(page.getByTestId(UPLOAD_IDS.select)).toBeEnabled();
  // The accepted prompt waits in the feed with its attachment, not in the queue.
  await expect(page.getByTestId(COMMAND_IDS.queue)).toHaveCount(0);

  await expect(byTestId(page, SESSION_FEED_IDS.virtualRow, { pending: 'true' }).getByTestId(ATTACHMENT_IDS.root)).toHaveAttribute(
    'data-attachment-id',
    originalId!,
  );

  await page.getByTestId(COMMAND_IDS.prompt).fill('Unsent next draft');
  await releaseCommandOutcome();
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  await expect(page.getByTestId(UPLOAD_IDS.select)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Unsent next draft');
});
