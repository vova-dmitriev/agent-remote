import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

export async function openTranscript(path: string, allowedRoot: string) {
  let root: string, resolved: string;

  try {
    [root, resolved] = await Promise.all([realpath(allowedRoot), realpath(path)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }

  const within = relative(root, resolved);

  if (within === '' || within === '..' || within.startsWith('../') || isAbsolute(within)) {
    throw new Error('TRANSCRIPT_OUTSIDE_ROOT');
  }

  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const info = await file.stat();

    if (!info.isFile()) {
      throw new Error('INVALID_TRANSCRIPT_FILE');
    }

    const current = await realpath(path),
      currentInfo = await stat(current);

    if (current !== resolved || currentInfo.dev !== info.dev || currentInfo.ino !== info.ino) {
      throw new Error('TRANSCRIPT_CHANGED_DURING_OPEN');
    }

    return { file, info };
  } catch (error) {
    await file.close();
    throw error;
  }
}
