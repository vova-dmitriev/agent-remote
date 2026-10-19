import { expect } from '@playwright/test';
import { test, selectSession } from './fixture.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';
import { SessionStatus } from '@protocol';
import { LocalDocumentKind } from '../../apps/daemon/src/local/state/values.js';

test('uses one approved browser identity for two viewers and rejects stale draft edits', async ({
  extension,
}) => {
  const [first, second] = await Promise.all([extension.open(), extension.open()]);

  await Promise.all([selectSession(first), selectSession(second)]);
  await first.getByTestId(COMMAND_IDS.prompt).fill('First viewer saved');

  const draft = () =>
    extension.runtime.controller.options.documents.get(
      'owner-local',
      extension.runtime.session.id,
      LocalDocumentKind.Draft,
    ).value;

  await expect.poll(draft).toMatchObject({ text: 'First viewer saved' });
  await second.getByTestId(COMMAND_IDS.prompt).fill('Stale second viewer');
  await expect(second.getByTestId(COMMAND_IDS.notice)).toBeVisible();
  expect(draft()).toMatchObject({ text: 'First viewer saved' });
  await first.getByTestId(COMMAND_IDS.prompt).fill('Only first sends');
  await first.getByTestId(COMMAND_IDS.prompt).press('Enter');
  await expect.poll(() => extension.runtime.delivered).toEqual(['Only first sends']);
});

test('opens the same shared UI in a full tab from a narrow viewer', async ({ extension }) => {
  const page = await extension.open();

  await page.setViewportSize({ width: 390, height: 740 });
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toBeVisible();
  const opened = extension.context.waitForEvent('page');

  await page.getByTestId(SHELL_IDS.openTab).click();
  const tab = await opened;

  await expect(tab.getByTestId(SESSION_CARD_IDS.root)).toBeVisible();
  expect(new URL(tab.url()).origin).toBe(new URL(page.url()).origin);
});

test('recovers after real MV3 worker termination without replaying a delivered prompt', async ({
  extension,
}) => {
  const page = await extension.open();

  await selectSession(page);
  await page.getByTestId(COMMAND_IDS.prompt).fill('Before worker restart');
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
  await expect.poll(() => extension.runtime.delivered).toEqual(['Before worker restart']);
  const browser = extension.context.browser();

  if (!browser) {
    throw new Error('Browser CDP unavailable');
  }

  const cdp = await browser.newBrowserCDPSession();
  const worker = extension.context.serviceWorkers()[0]!;
  const targets = await cdp.send('Target.getTargets');
  const target = targets.targetInfos.find((item) => item.url === worker.url());

  if (!target) {
    throw new Error('Worker target unavailable');
  }

  const before = await worker.evaluate(() => performance.timeOrigin);

  expect(await cdp.send('Target.closeTarget', { targetId: target.targetId })).toEqual({ success: true });

  // MV3 restarts reuse the Worker handle and CDP target; the JavaScript realm changes.
  await expect
    .poll(
      () =>
        worker
          .evaluate(() => performance.timeOrigin)
          .catch((error: unknown) => {
            if (error instanceof Error && error.message.includes('Service worker restarted')) {
              return before;
            }

            throw error;
          }),
      { timeout: 15000 },
    )
    .not.toBe(before);

  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled({ timeout: 15000 });
  extension.status(SessionStatus.Running);
  await new Promise(setImmediate);
  extension.status(SessionStatus.Idle);
  await page.getByTestId(COMMAND_IDS.prompt).fill('After worker restart');
  await page.getByTestId(COMMAND_IDS.prompt).press('Enter');

  await expect
    .poll(() => extension.runtime.delivered, { timeout: 15000 })
    .toEqual(['Before worker restart', 'After worker restart']);
});

test('expires a revoked response and removes cached conversation UI', async ({ extension }) => {
  const page = await extension.open();

  await selectSession(page);
  await page.getByTestId(COMMAND_IDS.prompt).fill('This revoked draft must not save');
  extension.runtime.grants.revoke(extension.clientId);
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(0);
  expect(extension.runtime.delivered).toEqual([]);

  expect(
    extension.runtime.controller.options.documents.get(
      'owner-local',
      extension.runtime.session.id,
      LocalDocumentKind.Draft,
    ).value,
  ).toBeNull();
});
