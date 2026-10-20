import { expect, type Locator } from '@playwright/test';
import { test, deviceFixture } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { UPLOAD_IDS } from '@/features/send-command/ui/attachments/test-ids.js';

const TOLERANCE_PX = 2;

async function box(locator: Locator) {
  const rect = await locator.boundingBox();

  if (!rect) throw new Error('MISSING_BOX');

  return rect;
}

async function firstLineCentre(prompt: Locator) {
  const rect = await box(prompt);

  const style = await prompt.evaluate((element) => {
    const computed = getComputedStyle(element);

    return {
      top: Number.parseFloat(computed.borderTopWidth) + Number.parseFloat(computed.paddingTop),
      line: Number.parseFloat(computed.lineHeight),
    };
  });

  return { centre: rect.y + style.top + style.line / 2 };
}

test('composer controls share one vertical centre and stay pinned to the bottom when the text grows', async ({ page }) => {
  const { sockets, deviceId } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[0]!.capabilities.attachments = { images: 'reference', files: 'reference' };
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  const prompt = page.getByTestId(COMMAND_IDS.prompt);
  const attach = page.getByTestId(UPLOAD_IDS.select);
  const send = page.getByTestId(COMMAND_IDS.send);

  await expect(attach).toBeVisible();

  const single = await firstLineCentre(prompt);
  const attachBox = await box(attach);
  const sendBox = await box(send);
  const singleBox = await box(prompt);
  const singleInset = singleBox.y + singleBox.height - (sendBox.y + sendBox.height);

  expect(Math.abs(attachBox.y + attachBox.height / 2 - single.centre)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(sendBox.y + sendBox.height / 2 - single.centre)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(await prompt.evaluate((element) => getComputedStyle(element).resize)).toBe('none');

  await prompt.fill('one\ntwo\nthree\nfour');

  const grown = await box(prompt);
  const grownSend = await box(send);

  expect(grown.height).toBeGreaterThan(sendBox.height + 2 * TOLERANCE_PX + 14);
  expect(Math.abs(grown.y + grown.height - (grownSend.y + grownSend.height) - singleInset)).toBeLessThanOrEqual(TOLERANCE_PX);
});
