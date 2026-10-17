import { expect } from '@playwright/test';
import { test } from '../support/relay-fixture.js';
import { byTestId } from '../support/testid.js';
import { SESSION_CARD_IDS } from '../../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SHELL_IDS } from '../../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';
import { setSessionLanguage } from '../support/session-language.js';
import { COMMAND_IDS } from '../../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { UPLOAD_IDS } from '../../../apps/mini-app/src/features/send-command/ui/attachments/test-ids.js';
import { image, file, openAttachments } from './fixture.js';

test('keeps attachment drafts scoped to a session across language and source changes', async ({ page }) => {
  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles([image, file]);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();

  const ids = await page
    .getByTestId(UPLOAD_IDS.pending)
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-upload-id')));

  await setSessionLanguage(page, 'ru', 'terminal-session');
  await expect(page.getByTestId(UPLOAD_IDS.status).first()).toHaveText('Готово к отправке');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  await expect(page.getByTestId(UPLOAD_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  expect(
    await page
      .getByTestId(UPLOAD_IDS.pending)
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-upload-id'))),
  ).toEqual(ids);

  await setSessionLanguage(page, 'en', 'terminal-session');
  await expect(page.getByTestId(UPLOAD_IDS.status).first()).toHaveText('Ready to send');
});

test('rejects count and size limits before uploading bytes', async ({ page }) => {
  let uploads = 0;

  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/attachments')) uploads++;
  });

  await openAttachments(page);

  await page
    .getByTestId(UPLOAD_IDS.input)
    .setInputFiles(Array.from({ length: 6 }, (_, index) => ({ ...file, name: `synthetic-${index}.json` })));

  await expect(page.getByTestId(UPLOAD_IDS.error)).toHaveText('Attach at most 5 files.');

  await page
    .getByTestId(UPLOAD_IDS.input)
    .setInputFiles({ ...file, buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });

  await expect(page.getByTestId(UPLOAD_IDS.error)).toContainText('10 MB');

  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(
    Array.from({ length: 3 }, (_, index) => ({
      ...file,
      name: `synthetic-${index}.json`,
      buffer: Buffer.alloc(8 * 1024 * 1024),
    })),
  );

  await expect(page.getByTestId(UPLOAD_IDS.error)).toContainText('20 MB');
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  expect(uploads).toBe(0);
});

test('aborts transfers and revokes local image URLs on logout', async ({ page }) => {
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL;

    URL.revokeObjectURL = (url) => {
      sessionStorage.setItem(
        'synthetic-revoked-urls',
        String(Number(sessionStorage.getItem('synthetic-revoked-urls')) + 1),
      );

      revoke(url);
    };
  });

  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(UPLOAD_IDS.image)).toBeVisible();
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await page.getByTestId(SHELL_IDS.logout).click();
  await expect(page.getByTestId(UPLOAD_IDS.root)).toHaveCount(0);

  expect(Number(await page.evaluate(() => sessionStorage.getItem('synthetic-revoked-urls')))).toBeGreaterThan(
    0,
  );
});

test('accepts dropped files and pasted images without losing text input', async ({ page }) => {
  await openAttachments(page);
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic clipboard image');

  const clipboardData = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();

    transfer.items.add(
      new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])], 'synthetic-paste.png', {
        type: 'image/png',
      }),
    );

    return transfer;
  });

  await page
    .getByTestId(COMMAND_IDS.root)
    .evaluate(
      (node, transfer) =>
        node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true })),
      clipboardData,
    );

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();

    transfer.items.add(new File(['Synthetic drop'], 'synthetic-drop.txt', { type: 'text/plain' }));

    return transfer;
  });

  await page.getByTestId(COMMAND_IDS.root).dispatchEvent('drop', { dataTransfer });
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(2);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Synthetic clipboard image');
});
