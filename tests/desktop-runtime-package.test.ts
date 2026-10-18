import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCAL_LIMITS } from '../packages/protocol/src/index.js';
import { installDesktopRuntime } from '../apps/desktop/src/runtime/install-runtime.js';
import { verifyDesktopRuntime } from '../scripts/desktop/verify-runtime-lib.mjs';
import { desktopRuntimeFixture } from './helpers/desktop-runtime-fixture.js';
import { packagedCompanionFixture } from './helpers/packaged-companion.js';
import { packageDesktopRuntime } from '../scripts/desktop/package-runtime.mjs';
import { desktopNodeTarget } from '../scripts/desktop/runtime-pin.mjs';

const cleanups: Array<() => Promise<unknown>> = [];
const itOnDarwin = it.skipIf(process.platform !== 'darwin');

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

itOnDarwin(
  'rejects a tampered runtime file and app-version, ABI, protocol, platform or architecture mismatch',
  async () => {
    const packaged = await desktopRuntimeFixture();

    cleanups.push(() => packaged.close());

    const metadata = {
      resourceRoot: packaged.artifact,
      platform: process.platform,
      architecture: process.arch,
      appVersion: '0.1.0',
      protocolVersion: LOCAL_LIMITS.protocolVersion,
    };

    await expect(verifyDesktopRuntime({ ...metadata, appVersion: '0.2.0' })).rejects.toThrow(
      'LOCAL_RUNTIME_UNTRUSTED',
    );

    await expect(
      verifyDesktopRuntime({ ...metadata, protocolVersion: LOCAL_LIMITS.protocolVersion + 1 }),
    ).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');

    await expect(verifyDesktopRuntime({ ...metadata, platform: 'wrong-platform' })).rejects.toThrow(
      'LOCAL_RUNTIME_UNTRUSTED',
    );

    await expect(verifyDesktopRuntime({ ...metadata, architecture: 'wrong-architecture' })).rejects.toThrow(
      'LOCAL_RUNTIME_UNTRUSTED',
    );

    const entry = join(packaged.artifact, 'apps/daemon/bin/remote.mjs');
    const { appendFile } = await import('node:fs/promises');

    await appendFile(entry, '\n// tampered\n');
    await expect(verifyDesktopRuntime(metadata)).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
  },
  60_000,
);

it('rejects a runtime that is not the maintained standalone Node release', async () => {
  const packaged = await packagedCompanionFixture(process.execPath);

  cleanups.push(() => packaged.close());

  await expect(
    packageDesktopRuntime({
      outputDirectory: join(packaged.sourceDirectory, 'output', 'desktop-reject'),
      nodePath: packaged.nodePath,
      sourceDirectory: packaged.sourceDirectory,
    }),
  ).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
});

it('uses a canonical module repository path when the package source directory is omitted', async () => {
  await expect(
    packageDesktopRuntime({
      outputDirectory: join(process.cwd(), 'artifacts', 'desktop-package-path-probe'),
      nodePath: '/missing/desktop-node',
    }),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
