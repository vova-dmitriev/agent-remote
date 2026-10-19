import { expect } from '@playwright/test';
import { test, selectSession } from './fixture.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SessionStatus } from '@protocol';

test('edits acknowledged queued work and sends it now exactly once during a running turn', async ({
  extension,
}) => {
  extension.status(SessionStatus.Running);
  const page = await extension.open();

  await selectSession(page);
  await page.getByTestId(COMMAND_IDS.prompt).fill('Original queued instruction');
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(1);
  await page.getByTestId(COMMAND_IDS.editQueued).click();
  await page.getByTestId(COMMAND_IDS.queuedEditorText).fill('Edited synthetic instruction');
  await page.getByTestId(COMMAND_IDS.saveQueuedEdit).click();
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('Edited synthetic instruction');
  await page.getByTestId(COMMAND_IDS.sendQueuedNow).click();
  await expect.poll(() => extension.runtime.delivered).toEqual(['Edited synthetic instruction']);
  await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(0);
  await page.close();
  extension.status(SessionStatus.Idle);
  const reopened = await extension.open();

  await selectSession(reopened);
  await expect(reopened.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(0);
  expect(extension.runtime.delivered).toEqual(['Edited synthetic instruction']);
});
