import { ErrorCode } from '@protocol';
import { readFile, lstat, realpath, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { stateDirectory } from '../config.js';
import { launchContextSchema } from './launch-context.js';

export async function restoreLaunch(path: string) {
  try {
    if (
      !/^[0-9a-f-]{36}\.json$/.test(basename(path)) ||
      (await realpath(dirname(path))) !== (await realpath(join(stateDirectory(), 'launchers')))
    ) {
      throw new Error();
    }

    const info = await lstat(path);

    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0 ||
      info.size > 1048576
    ) {
      throw new Error();
    }

    const context = launchContextSchema.parse(JSON.parse(await readFile(path, 'utf8')));

    await unlink(path);

    return context;
  } catch {
    throw new Error(ErrorCode.LAUNCH_CONTEXT_UNAVAILABLE);
  }
}
