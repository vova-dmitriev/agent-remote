import type { Stats } from 'node:fs';
import type { Server } from 'node:net';
import { chmod, link, lstat, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { CodedError, ErrorCode, hasErrorCode } from '@protocol';
import { DaemonErrorCode } from '../../error-codes.js';
import { prepareLocalSocket, removeOwnedSocket } from '../../local/server/socket-path.js';

// Refuses unsafe paths (symlinks, foreign or shared parent/socket), never replaces a live
// listener (DAEMON_ALREADY_RUNNING) and removes only an owned stale socket.
async function prepareHookSocket(path: string) {
  try {
    await prepareLocalSocket(path);
  } catch (error) {
    if (
      hasErrorCode(error, ErrorCode.LOCAL_COMPANION_MISMATCH) ||
      hasErrorCode(error, ErrorCode.LOCAL_COMPANION_TIMEOUT)
    ) {
      throw new CodedError(DaemonErrorCode.DAEMON_ALREADY_RUNNING);
    }

    throw error;
  }
}

const closeServer = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

export interface HookSocketBinding {
  /** Stops accepting and unlinks `path` while it is still this server's socket; open connections stay. */
  unbind(): Promise<void>;
  /** Unbinds and waits until every open connection has closed. */
  close(): Promise<void>;
}

/**
 * Binds `server` at `path`. libuv unlinks the bound name on close whatever it points to, so
 * the server binds a private staging name (no longer than the final name) and the socket is
 * hard-linked into place; link() never replaces a socket that appeared meanwhile.
 */
export async function bindHookSocket(server: Server, path: string): Promise<HookSocketBinding> {
  await prepareHookSocket(path);
  const staging = join(dirname(path), `.${randomBytes(4).toString('hex')}`);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);

    server.listen(staging, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  let owned: Stats | undefined;
  let linked = false;

  try {
    await chmod(staging, 0o600);
    owned = await lstat(staging);
    await link(staging, path);
    linked = true;
    await unlink(staging);
  } catch (error) {
    await closeServer(server);

    if (linked && owned) {
      await removeOwnedSocket(path, owned).catch(() => {});
    }

    throw (error as NodeJS.ErrnoException).code === 'EEXIST'
      ? new CodedError(DaemonErrorCode.DAEMON_ALREADY_RUNNING)
      : error;
  }

  const socket = owned;
  let closed: Promise<void> | undefined;

  const unbind = async () => {
    if (closed) {
      return;
    }

    closed = closeServer(server);
    await removeOwnedSocket(path, socket).catch(() => {});
  };

  return {
    unbind,
    async close() {
      await unbind();
      await closed;
    },
  };
}
