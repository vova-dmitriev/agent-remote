import { chmod, link, lstat, mkdir, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { ErrorCode } from '@protocol';

export async function privateFile(path: string, initial: () => string): Promise<string> {
  const directory = dirname(path);

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);

  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (process.getuid && parent.uid !== process.getuid())
  ) {
    throw new Error(ErrorCode.UNAUTHORIZED);
  }

  await chmod(directory, 0o700);

  const temporary = path + '.' + randomUUID();

  try {
    const created = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );

    try {
      await created.writeFile(initial());
      await created.sync();
    } finally {
      await created.close();
    }

    // A hard link publishes a complete file without replacing a concurrent winner.
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }

  const info = await lstat(path);

  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 65536 ||
    info.mode & 0o077 ||
    (process.getuid && info.uid !== process.getuid())
  ) {
    throw new Error(ErrorCode.UNAUTHORIZED);
  }

  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}
