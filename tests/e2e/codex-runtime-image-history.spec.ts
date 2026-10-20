import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { test } from './codex-runtime/fixture.js';
import type { Data } from './codex-runtime/model.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { ATTACHMENT_IDS } from '@/entities/attachment/config/test-ids.js';

test.use({ kind: 'codex-desktop' });

test('imports an existing Desktop image through /tmp and renders, opens and downloads its original bytes', async ({
  page,
  runtime,
}) => {
  const directory = await mkdtemp('/tmp/cr-history-image-');
  const path = join(directory, 'synthetic-history.png');

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );

  try {
    await writeFile(path, png);
    const { model } = runtime.provider;
    const items = model.turns[0]!.items as Data[];

    items.push({
      id: 'native-history-image',
      type: 'userMessage',
      content: [
        { type: 'text', text: 'Synthetic existing Desktop image' },
        { type: 'localImage', detail: null, path },
      ],
    });

    runtime.provider.disconnect();
    await expect.poll(() => runtime.current().integrationState).toBe('disconnected');
    await runtime.connect();
    await identity(page, '801', 'en');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': runtime.current().id }).click();
    const image = page.getByTestId(ATTACHMENT_IDS.image);

    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', /^blob:/u);
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
    await page.getByTestId(ATTACHMENT_IDS.open).click();
    await expect(page.getByTestId(ATTACHMENT_IDS.dialog)).toBeVisible();
    await expect(page.getByTestId(ATTACHMENT_IDS.viewerImage)).toHaveAttribute('src', /^blob:/u);
    await page.getByTestId(ATTACHMENT_IDS.close).click();
    const downloading = page.waitForEvent('download');

    await page.getByTestId(ATTACHMENT_IDS.download).click();
    const download = await downloading;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];

    if (!stream) throw new Error('DOWNLOAD_UNAVAILABLE');
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(png);
    expect(model.starts).toHaveLength(0);
    await page.reload();
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': runtime.current().id }).click();
    await expect(page.getByTestId(ATTACHMENT_IDS.image)).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
