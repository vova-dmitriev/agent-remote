import { link, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { removePackagerMetadata } from '../../../scripts/desktop/app/finalize-package.mjs';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function resourceRoot() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-package-finalize-'));

  roots.push(root);
  const canonical = await realpath(root);

  await mkdir(join(canonical, 'desktop-companion'));

  return join(canonical, 'desktop-companion');
}

async function writeManifest(root: string, files: Array<{ path: string }>) {
  await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify({ files }), { mode: 0o600 });
}

it('removes only unmanifested package metadata and leaves unknown runtime files for strict verification', async () => {
  const root = await resourceRoot();

  await writeManifest(root, [{ path: 'runtime/node' }]);
  await writeFile(join(root, '.DS_Store'), 'generated Finder metadata', { mode: 0o600 });
  await writeFile(join(root, 'unexpected.bin'), 'unknown runtime file', { mode: 0o600 });

  await expect(removePackagerMetadata(root)).resolves.toBe(true);
  await expect(rm(join(root, '.DS_Store'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(join(root, 'unexpected.bin'), 'utf8')).resolves.toBe('unknown runtime file');
});

it('rejects a symlink masquerading as package metadata', async () => {
  const root = await resourceRoot();

  await writeManifest(root, []);
  const target = join(root, 'outside');

  await writeFile(target, 'keep', { mode: 0o600 });
  await symlink(target, join(root, '.DS_Store'));

  await expect(removePackagerMetadata(root)).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
});

it('never removes a metadata path declared by the runtime manifest', async () => {
  const root = await resourceRoot();

  await writeManifest(root, [{ path: '.DS_Store' }]);
  await writeFile(join(root, '.DS_Store'), 'declared runtime content', { mode: 0o600 });

  await expect(removePackagerMetadata(root)).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
});

it('rejects hard-linked package metadata without removing either link', async () => {
  const root = await resourceRoot();

  await writeManifest(root, []);
  const target = join(root, 'outside');
  const metadata = join(root, '.DS_Store');

  await writeFile(target, 'shared file', { mode: 0o600 });
  await link(target, metadata);

  await expect(removePackagerMetadata(root)).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
  await expect(readFile(target, 'utf8')).resolves.toBe('shared file');
  await expect(readFile(metadata, 'utf8')).resolves.toBe('shared file');
});
