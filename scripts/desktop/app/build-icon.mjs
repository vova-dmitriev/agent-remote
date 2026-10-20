import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const assets = resolve(fileURLToPath(new URL('../../../apps/desktop/assets', import.meta.url)));
const svg = await readFile(join(assets, 'icon.svg'), 'utf8');
const iconset = (await mkdtemp(join(tmpdir(), 'agent-remote-icon-'))) + '/icon.iconset';

const files = [
  ...[16, 32, 128, 256, 512].flatMap((size) => [
    [`icon_${size}x${size}.png`, size],
    [`icon_${size}x${size}@2x.png`, size * 2],
  ]),
];

await mkdir(iconset, { recursive: true });
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

  for (const [name, size] of files) {
    await page.setViewportSize({ width: size, height: size });

    await page.setContent(
      `<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}"></body>`,
    );

    await page.screenshot({ path: join(iconset, name), omitBackground: true });
  }
} finally {
  await browser.close();
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(assets, 'icon.icns')]);
await rm(join(iconset, '..'), { recursive: true, force: true });
