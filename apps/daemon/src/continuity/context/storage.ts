import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { CheckpointError, checkpointFailure } from './values.js';

const uid = () => (typeof process.getuid === 'function' ? process.getuid() : null);

function privateStat(stat: Awaited<ReturnType<typeof lstat>>, directory = false) {
  if ((uid() !== null && stat.uid !== uid()) || (Number(stat.mode) & 0o077) !== 0) {
    throw checkpointFailure(CheckpointError.StorageUnsafe);
  }

  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    throw checkpointFailure(CheckpointError.StorageUnsafe);
  }
}

export async function ensurePrivateDirectory(path: string) {
  const requested = resolve(path);
  const parent = dirname(requested);

  privateStat(await lstat(parent), true);
  const absolute = join(await realpath(parent), basename(requested));

  try {
    await mkdir(absolute, { mode: 0o700 });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
  }

  const info = await lstat(absolute);

  privateStat(info, true);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);

  try {
    const opened = await handle.stat();

    if (opened.dev !== info.dev || opened.ino !== info.ino || (await realpath(absolute)) !== absolute) {
      throw checkpointFailure(CheckpointError.StorageUnsafe);
    }

    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }

  return absolute;
}

export async function writePrivateFile(directory: string, name: string, data: Uint8Array, maxBytes: number) {
  if (basename(name) !== name || name === '.' || name === '..' || data.byteLength > maxBytes) {
    throw checkpointFailure(CheckpointError.StorageSizeLimit);
  }

  const path = join(await ensurePrivateDirectory(directory), name);

  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );

  try {
    privateStat(await handle.stat());
    await handle.writeFile(data);
    await handle.sync();
    const after = await handle.stat();

    if (after.size !== data.byteLength || after.nlink !== 1) {
      throw checkpointFailure(CheckpointError.StorageUnsafe);
    }
  } catch (error) {
    await handle.close();
    await unlink(path).catch(() => undefined);
    throw error;
  }

  await handle.close();
}

export async function readPrivateFile(directory: string, name: string, maxBytes: number) {
  if (basename(name) !== name || name === '.' || name === '..') {
    throw checkpointFailure(CheckpointError.StorageUnsafe);
  }

  const path = join(await ensurePrivateDirectory(directory), name);
  let handle: import('node:fs/promises').FileHandle;

  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ELOOP') {
      throw checkpointFailure(CheckpointError.StorageUnsafe);
    }

    throw error;
  }

  try {
    const before = await handle.stat();

    privateStat(before);

    if (before.nlink !== 1 || !Number.isSafeInteger(before.size) || before.size > maxBytes) {
      throw checkpointFailure(CheckpointError.StorageSizeLimit);
    }

    const bytes = Buffer.alloc(before.size);
    let offset = 0;

    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);

      if (!result.bytesRead) {
        throw checkpointFailure(CheckpointError.StorageUnsafe);
      }

      offset += result.bytesRead;
    }

    const after = await handle.stat();

    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw checkpointFailure(CheckpointError.StorageUnsafe);
    }

    return bytes;
  } finally {
    await handle.close();
  }
}
