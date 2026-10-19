import { connect } from 'node:net';
import type { Stats } from 'node:fs';
import { lstat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CodedError, ErrorCode, LOCAL_LIMITS } from '@protocol';

export const LOCAL_SOCKET_LIMITS = {
  probeTimeoutMs: Math.min(2_000, LOCAL_LIMITS.requestTimeoutMs),
} as const;

async function inspectSocket(path: string): Promise<Stats | undefined> {
  const parent = await lstat(dirname(path));

  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.mode & 0o077 ||
    (process.getuid && parent.uid !== process.getuid())
  ) {
    throw new CodedError(ErrorCode.UNAUTHORIZED);
  }

  try {
    const socket = await lstat(path);

    if (
      !socket.isSocket() ||
      socket.isSymbolicLink() ||
      (socket.mode & 0o777) !== 0o600 ||
      (process.getuid && socket.uid !== process.getuid())
    ) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    return socket;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    return undefined;
  }
}

function requireRefusedConnection(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let settled = false;

    const timer = setTimeout(
      () => finish(ErrorCode.LOCAL_COMPANION_TIMEOUT),
      LOCAL_SOCKET_LIMITS.probeTimeoutMs,
    );

    const finish = (code?: string) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();

      if (code) {
        reject(new CodedError(code));
      } else {
        resolve();
      }
    };

    socket.once('connect', () => finish(ErrorCode.LOCAL_COMPANION_MISMATCH));

    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ECONNREFUSED' ? undefined : ErrorCode.LOCAL_COMPANION_MISMATCH);
    });
  });
}

export async function removeOwnedSocket(path: string, previous: Pick<Stats, 'ino' | 'dev'>) {
  const current = await inspectSocket(path);

  if (!current) {
    return;
  }

  if (current.ino !== previous.ino || current.dev !== previous.dev) {
    throw new CodedError(ErrorCode.UNAUTHORIZED);
  }

  await unlink(path);
}

export async function prepareLocalSocket(path: string) {
  const previous = await inspectSocket(path);

  if (!previous) {
    return;
  }

  await requireRefusedConnection(path);
  await removeOwnedSocket(path, previous);
}
