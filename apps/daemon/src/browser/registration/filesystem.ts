/* eslint-disable no-restricted-syntax -- installer diagnostics are human-readable text, not wire error codes */
import { constants, type Stats } from 'node:fs';
import { access, lstat, mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

export function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function assertSafeEntry(stat: Stats, path: string, ownerOnly = false): void {
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlink native host path: ${path}`);
  }

  const owner = process.getuid?.();
  const writableShared = (stat.mode & 0o022) !== 0;
  const trustedSticky = stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o1000) !== 0;

  if (
    (stat.uid !== owner && stat.uid !== 0) ||
    (writableShared && !trustedSticky) ||
    (ownerOnly && (stat.uid !== owner || (stat.mode & 0o077) !== 0))
  ) {
    throw new Error(`Unsafe native host ownership or permissions: ${path}`);
  }
}

export async function checkDirectory(path: string, create = false): Promise<void> {
  if (!isAbsolute(path) || path.includes('\0')) {
    throw new Error('Native host directory must be absolute');
  }

  const absolute = resolve(path);
  const parent = dirname(absolute);

  if (parent !== absolute) {
    await checkDirectory(parent, create);
  }

  let stat: Stats;

  try {
    stat = await lstat(absolute);
  } catch (error) {
    if (!create || !isMissing(error)) {
      throw error;
    }

    try {
      await mkdir(absolute, { mode: 0o700 });
    } catch (mkdirError) {
      if (!(
        typeof mkdirError === 'object' &&
        mkdirError !== null &&
        'code' in mkdirError &&
        mkdirError.code === 'EEXIST'
      )) {
        throw mkdirError;
      }
    }

    stat = await lstat(absolute);
  }

  assertSafeEntry(stat, absolute);

  if (!stat.isDirectory()) {
    throw new Error(`Native host parent is not a directory: ${absolute}`);
  }
}

export async function checkExecutable(path: string): Promise<void> {
  await checkDirectory(dirname(path));
  const stat = await lstat(path);

  assertSafeEntry(stat, path);

  const ownerCannotExecute = stat.uid === process.getuid?.() && (stat.mode & 0o100) === 0;

  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o111) === 0 || ownerCannotExecute) {
    throw new Error('Native host path must be a trusted executable file');
  }

  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error('Native host file is not executable by its owner');
  }
}

export async function readOwnedManifest(path: string): Promise<string | undefined> {
  let stat: Stats;

  try {
    stat = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }

    throw error;
  }

  assertSafeEntry(stat, path, true);

  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024) {
    throw new Error('Unsafe existing native host manifest');
  }

  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const opened = await handle.stat();

    if (opened.ino !== stat.ino || opened.dev !== stat.dev) {
      throw new Error('Native host manifest changed while reading');
    }

    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}
