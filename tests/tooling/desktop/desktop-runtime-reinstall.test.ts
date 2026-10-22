import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { LOCAL_LIMITS } from '@protocol';
import { installDesktopRuntime } from '@desktop/runtime/install-runtime.js';
import { desktopRuntimeFixture } from '../../helpers/desktop/desktop-runtime-fixture.js';
import { guardRuntimeProcesses } from '../../helpers/desktop/runtime-processes.js';

const cleanups: Array<() => Promise<unknown>> = [];
const itOnDarwin = it.skipIf(process.platform !== 'darwin');

guardRuntimeProcesses();

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

itOnDarwin(
  'installs a rebuilt runtime of the same app version and removes the one it replaces',
  async () => {
    const packaged = await desktopRuntimeFixture();
    const privateRoot = join(packaged.root, 'private app support');
    const runtimes = join(privateRoot, 'desktop-runtime');

    cleanups.push(
      () => packaged.close(),
      () => rm(privateRoot, { recursive: true, force: true }),
    );

    const metadata = {
      privateUserDataRoot: privateRoot,
      platform: process.platform,
      architecture: process.arch,
      appVersion: '0.1.0',
      protocolVersion: LOCAL_LIMITS.protocolVersion,
    };

    const first = await installDesktopRuntime({ sourceRoot: packaged.artifact, ...metadata });

    expect((await installDesktopRuntime({ sourceRoot: packaged.artifact, ...metadata })).root).toBe(
      first.root,
    );

    // A rebuild keeps the app version but changes a file, so its manifest changes.
    const manifestPath = join(packaged.artifact, 'runtime-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const extra = 'dist/synthetic-rebuild.txt';

    await writeFile(join(packaged.artifact, extra), 'rebuilt\n');
    manifest.files.push({ path: extra, sha256: createHash('sha256').update('rebuilt\n').digest('hex') });
    manifest.files.sort((a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : 1));
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const rebuilt = await installDesktopRuntime({ sourceRoot: packaged.artifact, ...metadata });

    expect(rebuilt.root).not.toBe(first.root);
    expect(await readFile(join(rebuilt.root, extra), 'utf8')).toBe('rebuilt\n');
    expect(await readdir(runtimes)).toEqual([basename(rebuilt.root)]);
  },
  120_000,
);
