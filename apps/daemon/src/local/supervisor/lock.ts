import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ErrorCode } from '../../../../../packages/protocol/src/error-codes.js';
import { safeEntry, secureDirectory } from './runtime.js';
import { CompanionStartup } from './values.js';

export async function acquireStartLock(directory: string): Promise<(() => Promise<void>) | null> {
  await secureDirectory(directory, true);
  const path = join(directory, CompanionStartup.lockFile);
  const nonce = randomUUID();
  let handle;

  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      const stat = await lstat(path);

      safeEntry(stat, true);

      if (!stat.isFile() || stat.nlink !== 1) {
        throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
      }

      // Age/PID guesses cannot prove that a detached child was never started.
      return null;
    }

    throw new Error(ErrorCode.LOCAL_COMPANION_START_FAILED);
  }

  const identity = await handle.stat();

  try {
    await handle.writeFile(JSON.stringify({ nonce, pid: process.pid }));
    await handle.sync();
  } finally {
    await handle.close();
  }

  return async () => {
    await secureDirectory(directory, true);
    const stat = await lstat(path);

    safeEntry(stat, true);

    if (stat.dev !== identity.dev || stat.ino !== identity.ino) {
      throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
    }

    await unlink(path);
  };
}
