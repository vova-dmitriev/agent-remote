import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { ErrorCode } from '@protocol';

const stateSchema = (value: unknown, clientId: string): string | undefined => {
  if (!value || typeof value !== 'object' || !('clientId' in value) || !('handle' in value)) {
    throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }

  const state = value as { clientId: unknown; handle: unknown };

  if (
    state.clientId !== clientId ||
    typeof state.handle !== 'string' ||
    !/^[a-f0-9]{64}$/.test(state.handle)
  ) {
    throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }

  return state.handle;
};

export async function readDesktopHandle(path: string, clientId: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);

    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 4096 ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    ) {
      throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
    }

    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      return stateSchema(JSON.parse(await file.readFile('utf8')), clientId);
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

export async function writeDesktopHandle(path: string, clientId: string, handle: string): Promise<void> {
  if (!/^[a-f0-9-]{36}$/.test(clientId) || !/^[a-f0-9]{64}$/.test(handle)) {
    throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }

  const directory = dirname(path);

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);

  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (process.getuid && parent.uid !== process.getuid())
  ) {
    throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }

  const temporary = `${path}.${randomUUID()}.tmp`;

  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );

  try {
    await file.writeFile(JSON.stringify({ clientId, handle }) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }

  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}
