import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildVite } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireDesktop = createRequire(resolve(root, 'apps/desktop/package.json'));
const { build: buildEsbuild } = requireDesktop('esbuild');
const output = resolve(root, 'apps/desktop/dist');
const renderer = resolve(output, 'renderer');

await Promise.all(
  ['main', 'preload', 'renderer'].map((directory) =>
    rm(resolve(output, directory), { recursive: true, force: true }),
  ),
);

await mkdir(resolve(output, 'main'), { recursive: true });
await mkdir(resolve(output, 'preload'), { recursive: true });

await buildVite({
  configFile: resolve(root, 'apps/mini-app/vite.desktop.config.ts'),
  build: { outDir: renderer, emptyOutDir: true },
});

await buildEsbuild({
  entryPoints: [resolve(root, 'apps/desktop/src/main/index.ts')],
  outfile: resolve(output, 'main/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: false,
});

await buildEsbuild({
  entryPoints: [resolve(root, 'apps/desktop/src/preload/index.ts')],
  outfile: resolve(output, 'preload/bridge.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: false,
});
