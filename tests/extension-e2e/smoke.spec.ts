import { expect } from '@playwright/test';
import { test, selectSession } from './fixture.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '../../apps/mini-app/src/pages/sessions/config/test-ids.js';
import { SessionStatus } from '../../packages/protocol/src/index.js';

test('loads MV3 UI under production CSP and restores drafts/filter through native messaging', async ({
  extension,
}) => {
  const page = await extension.open();

  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(1);
  await page.getByTestId(SESSIONS_PAGE_IDS.filterClaude).click();
  await selectSession(page);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic durable draft');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.filterClaude)).toHaveAttribute('aria-pressed', 'true');
  await page.close();
  const reopened = await extension.open();

  await expect(reopened.getByTestId(SESSIONS_PAGE_IDS.filterClaude)).toHaveAttribute('aria-pressed', 'true');
  await selectSession(reopened);
  await expect(reopened.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Synthetic durable draft');
  expect(extension.runtime.delivered).toEqual([]);
});

test('persists queue after closing the viewer and dispatches once when source is idle', async ({
  extension,
}) => {
  extension.status(SessionStatus.Running);
  const page = await extension.open();

  await selectSession(page);
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic queued instruction');
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('Synthetic queued instruction');
  await page.close();
  expect(extension.runtime.delivered).toEqual([]);
  extension.status(SessionStatus.Idle);
  await expect.poll(() => extension.runtime.delivered).toEqual(['Synthetic queued instruction']);
  const reopened = await extension.open();

  await selectSession(reopened);
  await expect(reopened.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(0);
  expect(extension.runtime.delivered).toEqual(['Synthetic queued instruction']);
});
