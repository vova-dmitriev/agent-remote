import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { CodedError, ErrorCode } from '@protocol';
import type { CompanionRuntime } from './types.js';

const untrusted = () => new CodedError(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);

export function canonicalPath(path: string): void {
  if (!isAbsolute(path) || path !== resolve(path) || path.includes('\0')) {
    throw untrusted();
  }
}

export function safeEntry(stat: Stats, ownerOnly = false): void {
  const uid = process.getuid?.();
  const stickyRoot = stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o1000) !== 0;

  if (
    stat.isSymbolicLink() ||
    (stat.uid !== uid && stat.uid !== 0) ||
    ((stat.mode & 0o022) !== 0 && !stickyRoot) ||
    (ownerOnly && (stat.uid !== uid || (stat.mode & 0o077) !== 0))
  ) {
    throw untrusted();
  }
}

export function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

export async function secureDirectory(path: string, ownerOnly = false, create = false): Promise<void> {
  canonicalPath(path);
  const parent = dirname(path);

  if (parent !== path) {
    await secureDirectory(parent);
  }

  let stat: Stats;

  try {
    stat = await lstat(path);
  } catch (error) {
    if (!create || !missing(error)) {
      throw untrusted();
    }

    try {
      await mkdir(path, { mode: 0o700 });
    } catch (mkdirError) {
      if (
        !mkdirError ||
        typeof mkdirError !== 'object' ||
        !('code' in mkdirError) ||
        mkdirError.code !== 'EEXIST'
      ) {
        throw untrusted();
      }
    }

    stat = await lstat(path);
  }

  safeEntry(stat, ownerOnly);

  if (!stat.isDirectory()) {
    throw untrusted();
  }
}

async function verifyFile(path: string, expected: string, executable: boolean): Promise<void> {
  canonicalPath(path);

  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw untrusted();
  }

  await secureDirectory(dirname(path));
  const stat = await lstat(path);

  safeEntry(stat);

  if (!stat.isFile() || stat.nlink !== 1 || (executable && (stat.mode & 0o100) === 0)) {
    throw untrusted();
  }

  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const opened = await handle.stat();

    if (opened.ino !== stat.ino || opened.dev !== stat.dev) {
      throw untrusted();
    }

    const hash = createHash('sha256');

    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }

    if (hash.digest('hex') !== expected) {
      throw untrusted();
    }
  } finally {
    await handle.close();
  }
}

export async function verifyCompanionRuntime(runtime: CompanionRuntime): Promise<void> {
  try {
    await verifyFile(runtime.nodePath, runtime.nodeSha256, true);
    await verifyFile(runtime.entryPath, runtime.entrySha256, false);
  } catch {
    throw untrusted();
  }
}
