import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCAL_LIMITS } from '@protocol';
import { installDesktopRuntime } from '@desktop/runtime/install-runtime.js';
import { verifyDesktopRuntime } from '../../../scripts/desktop/runtime/verify-runtime-lib.mjs';
import { desktopRuntimeFixture } from '../../helpers/desktop/desktop-runtime-fixture.js';
import { guardRuntimeProcesses } from '../../helpers/desktop/runtime-processes.js';
import { desktopNodeTarget } from '../../../scripts/desktop/runtime/runtime-pin.mjs';

const cleanups: Array<() => Promise<unknown>> = [];
const itOnDarwin = it.skipIf(process.platform !== 'darwin');

guardRuntimeProcesses();

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

itOnDarwin(
  'keeps verified launcher files stable after the application bundle moves',
  async () => {
    const packaged = await desktopRuntimeFixture();
    const privateRoot = join(packaged.root, 'private app support');

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

    const bundled = await verifyDesktopRuntime({ ...metadata, resourceRoot: packaged.artifact });

    expect(bundled.manifest).toMatchObject({
      node: 'v22.23.3',
      abi: '127',
      nodeArchiveSha256: desktopNodeTarget(process.platform, process.arch).archiveSha256,
    });

    const installed = await installDesktopRuntime({ sourceRoot: packaged.artifact, ...metadata });

    expect(installed.nodePath).toContain(join(privateRoot, 'desktop-runtime'));
    expect(installed.entryPath).toContain(join(privateRoot, 'desktop-runtime'));
    await rm(packaged.artifact, { recursive: true, force: true });

    await expect(verifyDesktopRuntime({ ...metadata, resourceRoot: installed.root })).resolves.toMatchObject({
      nodePath: installed.nodePath,
      entryPath: installed.entryPath,
    });
  },
  60_000,
);
