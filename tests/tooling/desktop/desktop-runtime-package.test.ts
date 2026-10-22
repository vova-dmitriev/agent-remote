import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_LIMITS } from '@protocol';
import { verifyDesktopRuntime } from '../../../scripts/desktop/runtime/verify-runtime-lib.mjs';
import { desktopRuntimeFixture } from '../../helpers/desktop/desktop-runtime-fixture.js';
import { packagedCompanionFixture } from '../../helpers/desktop/packaged-companion.js';
import { guardRuntimeProcesses } from '../../helpers/desktop/runtime-processes.js';
import {
  copyRuntimeTree,
  packageDesktopRuntime,
  runtimeFiles,
} from '../../../scripts/desktop/runtime/package-runtime.mjs';
import { FINDER_METADATA, listRuntimeFiles } from '../../../scripts/desktop/runtime/runtime-files.mjs';

const cleanups: Array<() => Promise<unknown>> = [];
const itOnDarwin = it.skipIf(process.platform !== 'darwin');

guardRuntimeProcesses();

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

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
}, 60_000);

it('uses a canonical module repository path when the package source directory is omitted', async () => {
  await expect(
    packageDesktopRuntime({
      outputDirectory: join(process.cwd(), 'artifacts', 'desktop-package-path-probe'),
      nodePath: '/missing/desktop-node',
    }),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

async function runtimeTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runtime-files-'));

  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'sub'), { mode: 0o755 });
  await writeFile(join(root, 'a.txt'), 'a', { mode: 0o644 });
  await writeFile(join(root, 'sub', 'b.txt'), 'b', { mode: 0o644 });

  return root;
}

it('ignores Finder metadata files at any depth when listing runtime files', async () => {
  const root = await runtimeTree();

  await writeFile(join(root, FINDER_METADATA), 'x', { mode: 0o644 });
  await writeFile(join(root, 'sub', FINDER_METADATA), 'x', { mode: 0o644 });

  await expect(listRuntimeFiles(root)).resolves.toEqual(['a.txt', 'sub/b.txt']);
});

it('still rejects Finder metadata that is a symlink, a directory or group-writable', async () => {
  const symlinked = await runtimeTree();

  await symlink('a.txt', join(symlinked, FINDER_METADATA));
  await expect(listRuntimeFiles(symlinked)).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');

  const directory = await runtimeTree();

  await mkdir(join(directory, 'sub', FINDER_METADATA), { mode: 0o755 });
  await expect(listRuntimeFiles(directory)).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');

  const writable = await runtimeTree();
  const { chmod } = await import('node:fs/promises');

  await writeFile(join(writable, FINDER_METADATA), 'x');
  await chmod(join(writable, FINDER_METADATA), 0o666);
  await expect(listRuntimeFiles(writable)).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
});

it('keeps listing other files so undeclared ones are still rejected by the verifier', async () => {
  const root = await runtimeTree();

  await writeFile(join(root, FINDER_METADATA), 'x', { mode: 0o644 });
  await writeFile(join(root, '._a.txt'), 'x', { mode: 0o644 });

  await expect(listRuntimeFiles(root)).resolves.toContain('._a.txt');
});

it('leaves Finder metadata out of the staged manifest and the copied output', async () => {
  const staging = await runtimeTree();
  const output = join(await mkdtemp(join(tmpdir(), 'runtime-output-')), 'out');

  cleanups.push(() => rm(join(output, '..'), { recursive: true, force: true }));
  await writeFile(join(staging, FINDER_METADATA), 'x', { mode: 0o644 });
  await writeFile(join(staging, 'sub', FINDER_METADATA), 'x', { mode: 0o644 });
  await mkdir(output);

  expect((await runtimeFiles(staging)).map((file: { path: string }) => file.path)).toEqual([
    'a.txt',
    'sub/b.txt',
  ]);

  await copyRuntimeTree(staging, output);
  await expect(listRuntimeFiles(output)).resolves.toEqual(['a.txt', 'sub/b.txt']);
  await expect(readdir(output)).resolves.not.toContain(FINDER_METADATA);
  await expect(readdir(join(output, 'sub'))).resolves.not.toContain(FINDER_METADATA);
});
