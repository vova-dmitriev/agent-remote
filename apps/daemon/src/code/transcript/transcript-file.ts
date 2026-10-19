import { DaemonErrorCode } from '../../error-codes.js';
import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { CodedError } from '@protocol';

/** Opens a regular transcript file whose real path stays inside `allowedRoot`; `undefined` when it is missing. */
export async function openTranscript(path: string, allowedRoot: string, refuseSymlinks = false) {
  let root: string, resolved: string;

  try {
    if (refuseSymlinks) {
      const link = await lstat(path);

      if (link.isSymbolicLink() || !link.isFile()) {
        throw new CodedError(DaemonErrorCode.INVALID_TRANSCRIPT_FILE);
      }
    }

    [root, resolved] = await Promise.all([realpath(allowedRoot), realpath(path)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }

  const within = relative(root, resolved);

  if (within === '' || within === '..' || within.startsWith('../') || isAbsolute(within)) {
    throw new CodedError(DaemonErrorCode.TRANSCRIPT_OUTSIDE_ROOT);
  }

  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const info = await file.stat();

    if (!info.isFile()) {
      throw new CodedError(DaemonErrorCode.INVALID_TRANSCRIPT_FILE);
    }

    const current = await realpath(path),
      currentInfo = await stat(current);

    if (current !== resolved || currentInfo.dev !== info.dev || currentInfo.ino !== info.ino) {
      throw new CodedError(DaemonErrorCode.TRANSCRIPT_CHANGED_DURING_OPEN);
    }

    return { file, info };
  } catch (error) {
    await file.close();
    throw error;
  }
}
