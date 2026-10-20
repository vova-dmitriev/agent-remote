import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPinnedDesktopNode,
  desktopNodeTarget,
  DESKTOP_NODE_RELEASE,
} from '../../../scripts/desktop/runtime-pin.mjs';
import { prepareDesktopNode, verifyPreparedRuntime } from '../../../scripts/desktop/prepare-runtime.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function preparedRuntimeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-node-cache-'));

  temporaryDirectories.push(root);

  const directory = join(await realpath(root), 'node-cache');
  const memberRoot = 'node-v22.23.3-darwin-arm64';
  const memberDirectory = join(root, memberRoot, 'bin');
  const nodePath = join(directory, 'bin', 'node');
  const sourceNodePath = join(memberDirectory, 'node');

  const expectedNode = Buffer.from(
    '#!/bin/sh\nprintf \'%s\\n\' \'{"version":"v22.23.3","abi":"127","platform":"darwin","arch":"arm64"}\'\n',
  );

  await mkdir(join(directory, 'bin'), { recursive: true, mode: 0o700 });
  await mkdir(memberDirectory, { recursive: true, mode: 0o700 });
  await writeFile(sourceNodePath, expectedNode, { mode: 0o700 });

  const sourceArchive = join(root, 'official-node.tar.gz');

  execFileSync('tar', ['-czf', sourceArchive, '-C', root, memberRoot]);

  const archive = await readFile(sourceArchive);
  const archiveSha256 = createHash('sha256').update(archive).digest('hex');
  const archivePath = join(directory, 'node-archive.tar.gz');

  await writeFile(nodePath, expectedNode, { mode: 0o700 });
  await writeFile(archivePath, archive, { mode: 0o600 });

  return {
    root,
    directory,
    nodePath,
    archivePath,
    target: {
      target: 'darwin-arm64',
      archiveName: 'node-v22.23.3-darwin-arm64.tar.gz',
      archiveSha256,
    },
  };
}

describe('desktop Node release pin', () => {
  it('pins official Node archive checksums for both macOS architectures', () => {
    expect(DESKTOP_NODE_RELEASE).toMatchObject({
      version: 'v22.23.3',
      abi: '127',
      checksumSource: 'https://nodejs.org/dist/v22.23.3/SHASUMS256.txt',
    });

    expect(desktopNodeTarget('darwin', 'arm64').archiveSha256).toBe(
      '23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53',
    );

    expect(desktopNodeTarget('darwin', 'x64').archiveSha256).toBe(
      '8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8',
    );
  });

  it('rejects unsupported platforms and obsolete standalone Node binaries', async () => {
    expect(() => desktopNodeTarget('linux', 'x64')).toThrow('Unsupported desktop runtime target');

    const directory = await mkdtemp(join(tmpdir(), 'desktop-obsolete-node-'));

    temporaryDirectories.push(directory);
    const obsolete = join(directory, 'node');

    await writeFile(
      obsolete,
      `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ version: 'v22.12.0', abi: '127', platform: process.platform, arch: process.arch })}'\n`,
      { mode: 0o700 },
    );

    expect(() => assertPinnedDesktopNode(obsolete, process.platform, process.arch)).toThrow(
      'LOCAL_RUNTIME_UNTRUSTED',
    );
  });

  it('binds cached Node bytes to the checksum-verified archive, not matching self-reported metadata', async () => {
    const fixture = await preparedRuntimeFixture();

    await expect(verifyPreparedRuntime(fixture.directory, 'darwin', 'arm64', fixture.target)).resolves.toBe(
      fixture.nodePath,
    );

    const metadataMatchingShim = Buffer.from(
      '#!/bin/sh\nprintf \'%s\\n\' \'{"version":"v22.23.3","abi":"127","platform":"darwin","arch":"arm64"}\'\n# forged shim\n',
    );

    await writeFile(fixture.nodePath, metadataMatchingShim, { mode: 0o700 });

    await expect(verifyPreparedRuntime(fixture.directory, 'darwin', 'arm64', fixture.target)).rejects.toThrow(
      'LOCAL_RUNTIME_UNTRUSTED',
    );
  });

  it('rejects symlinked archive and cache binaries without trusting a checksum receipt', async () => {
    const fixture = await preparedRuntimeFixture();
    const externalFile = join(fixture.root, 'external-archive');

    temporaryDirectories.push(externalFile);
    await writeFile(externalFile, await readFile(fixture.archivePath));
    await rm(fixture.archivePath);
    await symlink(externalFile, fixture.archivePath);
    await writeFile(join(fixture.directory, 'archive-sha256.txt'), `${fixture.target.archiveSha256}\n`);

    await expect(verifyPreparedRuntime(fixture.directory, 'darwin', 'arm64', fixture.target)).rejects.toThrow(
      'LOCAL_RUNTIME_UNTRUSTED',
    );

    await rm(fixture.archivePath);
    await writeFile(fixture.archivePath, await readFile(externalFile), { mode: 0o600 });
    const outsideNode = join(tmpdir(), `desktop-node-binary-external-${process.pid}`);

    temporaryDirectories.push(outsideNode);
    await writeFile(outsideNode, await readFile(fixture.nodePath), { mode: 0o700 });
    await rm(fixture.nodePath);
    await symlink(outsideNode, fixture.nodePath);

    await expect(verifyPreparedRuntime(fixture.directory, 'darwin', 'arm64', fixture.target)).rejects.toThrow(
      'LOCAL_RUNTIME_UNTRUSTED',
    );
  });

  it('rejects a legacy checksum symlink and a symlinked runtime cache directory', async () => {
    const fixture = await preparedRuntimeFixture();
    const checksumLink = join(fixture.directory, 'archive-sha256.txt');
    const externalReceipt = join(fixture.root, 'external-receipt');

    await writeFile(externalReceipt, `${fixture.target.archiveSha256}\n`);
    await symlink(externalReceipt, checksumLink);
    await rm(fixture.archivePath);

    await expect(
      verifyPreparedRuntime(fixture.directory, 'darwin', 'arm64', fixture.target),
    ).rejects.toThrow();

    const symlinkedCache = join(fixture.root, 'node-darwin-arm64');

    await symlink(fixture.directory, symlinkedCache);

    await expect(
      prepareDesktopNode({
        platform: 'darwin',
        architecture: 'arm64',
        toolchainRoot: fixture.root,
      }),
    ).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
  });
});
