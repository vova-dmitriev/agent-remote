import { constants } from 'node:fs';
import { link, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import {
  assertSafeEntry,
  checkDirectory,
  checkExecutable,
  isMissing,
  readOwnedManifest,
} from './filesystem.js';
import { createNativeHostManifest, isMatchingManifest } from './manifest.js';
import { nativeHostManifestPath } from './paths.js';
import type { NativeHostManifest, NativeHostRegistration, NativeHostRegistrationResult } from './types.js';

function requireMatchingManifest(contents: string, manifest: NativeHostManifest): void {
  let existing: unknown;

  try {
    existing = JSON.parse(contents);
  } catch {
    throw new Error('Existing manifest is not an owned native host registration');
  }

  if (!isMatchingManifest(existing, manifest)) {
    throw new Error('Existing manifest is not a matching owned native host registration');
  }
}

async function writeAtomic(path: string, manifest: NativeHostManifest): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;

  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );

  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    await checkDirectory(dirname(path));
    // Hard-link publishes the complete file atomically and refuses replacement.
    await link(temporary, path);
  } finally {
    await handle.close();
    await unlink(temporary);
  }
}

export async function registerNativeHost(
  options: NativeHostRegistration,
): Promise<NativeHostRegistrationResult> {
  const manifestPath = nativeHostManifestPath(options);
  const manifest = createNativeHostManifest(options);

  await checkExecutable(manifest.path);
  await checkDirectory(dirname(manifestPath), true);
  const existing = await readOwnedManifest(manifestPath);

  if (existing !== undefined) {
    requireMatchingManifest(existing, manifest);
  } else {
    await writeAtomic(manifestPath, manifest);
  }

  return { manifestPath };
}

export async function unregisterNativeHost(options: NativeHostRegistration): Promise<boolean> {
  const manifestPath = nativeHostManifestPath(options);
  const manifest = createNativeHostManifest(options);

  try {
    await checkDirectory(dirname(manifestPath));
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }

  const contents = await readOwnedManifest(manifestPath);

  if (contents === undefined) {
    return false;
  }

  requireMatchingManifest(contents, manifest);
  const handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    assertSafeEntry(await handle.stat(), manifestPath, true);
    await checkDirectory(dirname(manifestPath));

    if ((await readOwnedManifest(manifestPath)) !== contents) {
      throw new Error('Existing native manifest changed before uninstall');
    }

    await unlink(manifestPath);
  } finally {
    await handle.close();
  }

  return true;
}
