import { cp, lstat, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ErrorCode } from '@protocol';
import { secureDirectory } from '@daemon/local/supervisor/runtime.js';
import { verifyDesktopRuntime } from '../../../../scripts/desktop/runtime/verify-runtime-lib.mjs';

export async function installDesktopRuntime(options: {
  sourceRoot: string;
  privateUserDataRoot: string;
  appVersion: string;
  platform: string;
  architecture: string;
  protocolVersion: number;
}) {
  await secureDirectory(options.privateUserDataRoot, true, true);
  const parent = join(options.privateUserDataRoot, 'desktop-runtime');

  await secureDirectory(parent, true, true);

  const existing = await verifyDesktopRuntime({ ...options, resourceRoot: options.sourceRoot }).catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      return null;
    },
  );

  if (!existing) {
    throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }

  // The manifest lists every file's sha256, so its digest names this exact build: a rebuild of the same app version
  // installs beside the old runtime instead of reusing it.
  const build = createHash('sha256').update(JSON.stringify(existing.manifest)).digest('hex').slice(0, 16);
  const name = `${options.appVersion}-${options.platform}-${options.architecture}-${existing.manifest.abi}-${build}`;
  const target = join(parent, name);

  try {
    const info = await lstat(target);

    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
    }

    return await verifyDesktopRuntime({ ...options, resourceRoot: target });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const staging = join(parent, `.staging-${randomUUID()}`);

  try {
    await cp(existing.root, staging, { recursive: true, force: true, errorOnExist: false });
    await verifyDesktopRuntime({ ...options, resourceRoot: staging });

    try {
      await rename(staging, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      await rm(staging, { recursive: true, force: true });
    }

    const installed = await verifyDesktopRuntime({ ...options, resourceRoot: target });

    await removeReplaced(parent, name);

    return installed;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Removes the runtimes this install replaced; a companion still running from one keeps its open files. */
async function removeReplaced(parent: string, current: string) {
  for (const entry of await readdir(parent)) {
    if (entry !== current && !entry.startsWith('.')) {
      await rm(join(parent, entry), { recursive: true, force: true });
    }
  }
}
