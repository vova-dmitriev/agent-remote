import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test, deviceFixture, publishMessages } from '../support/relay-fixture.js';
import { ATTACHMENT_IDS } from '@/entities/attachment/config/test-ids.js';
import { openAttachments, image, png } from './fixture.js';

async function openViewer(page: Page, bytes = png) {
  await openAttachments(page);
  const f = deviceFixture();
  const owner = (await f.relay.db.pool.query('SELECT owner_id FROM devices WHERE id=$1', [f.deviceId])).rows[0].owner_id as string;

  const attachment = await f.relay.attachments.store({ ownerId: owner, deviceId: f.deviceId, sessionId: 'terminal-session' }, {
    uploadId: crypto.randomUUID(), generation: 'g', name: image.name, mimeType: image.mimeType, bytes,
  }, true);

  await publishMessages([{ id: 'full-image', role: 'assistant', text: '', occurredAt: Date.now(), attachments: [attachment] }]);
  await page.getByTestId(ATTACHMENT_IDS.open).click();
  await expect(page.getByTestId(ATTACHMENT_IDS.viewerImage)).toHaveAttribute('src', /^blob:/u);
}

test('uses the full Mini App viewport, downloads original bytes, and restores focus and fit on reopen', async ({ page }) => {
  await openViewer(page);
  const viewer = page.getByTestId(ATTACHMENT_IDS.dialog);

  await expect(viewer).toBeVisible();
  const bounds = await viewer.boundingBox(), viewport = page.viewportSize()!;

  expect(bounds).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expect(page.getByTestId(ATTACHMENT_IDS.zoom)).toHaveText('100%');
  await page.getByTestId(ATTACHMENT_IDS.zoomIn).click();
  await expect(page.getByTestId(ATTACHMENT_IDS.zoom)).toHaveText('125%');
  const downloading = page.waitForEvent('download');

  await page.getByTestId(ATTACHMENT_IDS.viewerDownload).click();
  const download = await downloading, stream = await download.createReadStream(), chunks: Buffer[] = [];

  if (!stream) throw new Error('DOWNLOAD_UNAVAILABLE');
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(createHash('sha256').update(png).digest('hex'));
  await page.getByTestId(ATTACHMENT_IDS.close).press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(page.getByTestId(ATTACHMENT_IDS.open)).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await page.getByTestId(ATTACHMENT_IDS.open).click();
  await expect(page.getByTestId(ATTACHMENT_IDS.zoom)).toHaveText('100%');
});

test('fits large images, supports native size, zoom buttons, drag, touch pinch and wheel, then resets', async ({ page }) => {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');

    canvas.width = 2400; canvas.height = 1600;
    const context = canvas.getContext('2d')!;

    context.fillStyle = '#135f99'; context.fillRect(0, 0, 2400, 1600);
    context.fillStyle = '#deefca'; context.fillRect(800, 400, 800, 800);

    return canvas.toDataURL('image/png').split(',')[1]!;
  });

  await openViewer(page, Buffer.from(encoded, 'base64'));
  const picture = page.getByTestId(ATTACHMENT_IDS.viewerImage), stage = page.getByTestId(ATTACHMENT_IDS.viewport);
  const zoom = page.getByTestId(ATTACHMENT_IDS.zoom);

  await expect(zoom).toHaveText('16%');
  const fitted = await picture.boundingBox(), space = await stage.boundingBox();

  expect(fitted!.width).toBeLessThanOrEqual(space!.width + 1);
  expect(fitted!.height).toBeLessThanOrEqual(space!.height + 1);
  await page.getByTestId(ATTACHMENT_IDS.original).click();
  await expect(zoom).toHaveText('100%');
  await page.getByTestId(ATTACHMENT_IDS.zoomOut).click();
  await expect(zoom).toHaveText('80%');
  await page.getByTestId(ATTACHMENT_IDS.zoomIn).click();
  await expect(zoom).toHaveText('100%');
  const bounds = (await stage.boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;

  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 70, y + 50, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => Number(await picture.getAttribute('data-pan-x'))).toBeGreaterThan(60);
  await expect.poll(async () => Number(await picture.getAttribute('data-pan-y'))).toBeGreaterThan(40);
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 35, y }, { x: x + 35, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 75, y }, { x: x + 75, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => Number(await picture.getAttribute('data-scale'))).toBeGreaterThan(1.5);
  const pinched = Number(await picture.getAttribute('data-scale'));

  await stage.hover(); await page.mouse.wheel(0, -150);
  await expect.poll(async () => Number(await picture.getAttribute('data-scale'))).toBeGreaterThan(pinched);
  await page.getByTestId(ATTACHMENT_IDS.fit).click();
  await expect(zoom).toHaveText('16%');
  await expect(picture).toHaveAttribute('data-pan-x', '0');
  await expect(picture).toHaveAttribute('data-pan-y', '0');
  await page.screenshot({ path: 'artifacts/image-fullscreen-fit-mobile.png' });
});
