import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFile } from '../../../apps/daemon/src/attachments/relay/io.js';

const directories: string[] = [];
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x01]);

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(root: string) {
  const directory = await mkdtemp(join(root, 'native-image-path-'));

  directories.push(directory);
  const path = join(directory, 'image.jpg');

  await writeFile(path, bytes);

  return { directory, path };
}

describe.skipIf(process.platform !== 'darwin')('native images through macOS system aliases', () => {
  it('reads the exact native attachment through /tmp while retaining byte integrity', async () => {
    const { path } = await fixture('/tmp');

    expect(await realpath(path)).toMatch(/^\/private\/tmp\//u);
    await expect(nativeFile(path)).resolves.toEqual(bytes);
  });

  it('reads native attachments through the /var system alias', async () => {
    const { path } = await fixture('/var/tmp');
    const canonical = await realpath(path);

    expect(canonical).toMatch(/^\/private\/var\//u);
    await expect(nativeFile(canonical.slice('/private'.length))).resolves.toEqual(bytes);
  });

  it('continues to reject a file symlink below /tmp', async () => {
    const { directory, path } = await fixture('/tmp');
    const linked = join(directory, 'linked.jpg');

    await symlink(path, linked);
    await expect(nativeFile(linked)).rejects.toThrow('ATTACHMENT_SOURCE_UNAVAILABLE');
  });

  it('continues to reject a directory symlink below /tmp', async () => {
    const { directory } = await fixture('/tmp');
    const actual = join(directory, 'actual');

    await mkdir(actual);
    await writeFile(join(actual, 'image.jpg'), bytes);
    const linked = join(directory, 'linked');

    await symlink(actual, linked);
    await expect(nativeFile(join(linked, 'image.jpg'))).rejects.toThrow('ATTACHMENT_SOURCE_UNAVAILABLE');
  });
});
