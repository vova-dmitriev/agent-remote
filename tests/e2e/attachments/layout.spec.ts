import { expect } from '@playwright/test';
import { test, delivered } from '../support/relay-fixture.js';
import { byTestId } from '../support/testid.js';
import { SESSION_CARD_IDS } from '../../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../../apps/mini-app/src/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '../../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { UPLOAD_IDS } from '../../../apps/mini-app/src/features/send-command/ui/attachments/test-ids.js';
import { file, image, openAttachments } from './fixture.js';

test('keeps attachment controls usable in a dark short mobile viewport', async ({ page }) => {
  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles([image, file]);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 400 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeInViewport();
  await expect(page.getByTestId(UPLOAD_IDS.select)).toBeInViewport();
  await expect(page.getByTestId(UPLOAD_IDS.remove).first()).toBeInViewport();

  expect(
    await page.getByTestId(COMMAND_IDS.root).evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);

  await page.screenshot({ path: 'artifacts/attachments-dark-short-mobile.png', fullPage: true });
});

test('sends a native-image-capable Codex source only its own session attachments', async ({ page }) => {
  await openAttachments(page);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(file);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  const terminalId = await page.getByTestId(UPLOAD_IDS.pending).getAttribute('data-upload-id');

  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-cli-session' }).click();
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles(image);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => delivered.length).toBe(1);

  expect(delivered[0]).toMatchObject({
    sessionId: 'codex-cli-session',
    target: { kind: 'codex-cli' },
    action: { type: 'prompt', text: '', attachments: [{ name: image.name }] },
  });

  const action = delivered[0]!.action;

  if (action.type !== 'prompt') throw new Error('EXPECTED_PROMPT');
  expect(action.attachments?.[0]?.id).not.toBe(terminalId);
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveAttribute('data-upload-id', terminalId!);
});

test('keeps the paperclip inside the input and adds a row only for pending attachments', async ({ page }) => {
  await openAttachments(page);
  await page.setViewportSize({ width: 390, height: 400 });
  await expect(page.getByTestId(COMMAND_IDS.root).getByTestId(COMMAND_IDS.interrupt)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.actionsTrigger)).toBeInViewport();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const prompt = page.getByTestId(COMMAND_IDS.prompt);
  const select = page.getByTestId(UPLOAD_IDS.select);
  const emptyPrompt = await prompt.boundingBox();
  const emptySelect = await select.boundingBox();

  expect(emptySelect!.x).toBeGreaterThanOrEqual(emptyPrompt!.x);
  expect(emptySelect!.y).toBeGreaterThanOrEqual(emptyPrompt!.y);
  expect(emptySelect!.x + emptySelect!.width).toBeLessThanOrEqual(emptyPrompt!.x + emptyPrompt!.width);
  expect(emptySelect!.y + emptySelect!.height).toBeLessThanOrEqual(emptyPrompt!.y + emptyPrompt!.height);

  const emptyHeight = (await page.getByTestId(COMMAND_IDS.root).boundingBox())!.height;

  await page.screenshot({ path: 'artifacts/attachments-empty-dark-short-mobile.png', fullPage: true });
  await page.getByTestId(UPLOAD_IDS.input).setInputFiles([image, file]);
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
  const filledPrompt = await prompt.boundingBox();
  const pending = await page.getByTestId(UPLOAD_IDS.pending).first().boundingBox();
  const filledSelect = await select.boundingBox();

  expect(pending!.y + pending!.height).toBeLessThanOrEqual(filledPrompt!.y);
  expect(filledSelect!.y).toBeGreaterThanOrEqual(filledPrompt!.y);

  expect(await prompt.evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft))).toBeGreaterThan(
    emptySelect!.width,
  );

  await page.getByTestId(UPLOAD_IDS.remove).first().click();
  await page.getByTestId(UPLOAD_IDS.remove).click();
  await expect(page.getByTestId(UPLOAD_IDS.pending)).toHaveCount(0);

  await expect
    .poll(async () => (await page.getByTestId(COMMAND_IDS.root).boundingBox())!.height)
    .toBe(emptyHeight);
});
