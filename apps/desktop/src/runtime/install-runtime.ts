import { cp, lstat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

  const target = join(
    parent,
    `${options.appVersion}-${options.platform}-${options.architecture}-${existing.manifest.abi}`,
  );

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

    return await verifyDesktopRuntime({ ...options, resourceRoot: target });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
