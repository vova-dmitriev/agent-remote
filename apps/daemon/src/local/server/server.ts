import { createServer, type Socket } from 'node:net';
import { chmod, lstat } from 'node:fs/promises';
import { LOCAL_LIMITS } from '@protocol';
import { acceptLocalPeer } from './connection.js';
import { prepareLocalSocket, removeOwnedSocket } from './socket-path.js';
import type { LocalServerOptions } from './types.js';

export async function startLocalServer(options: LocalServerOptions) {
  await prepareLocalSocket(options.path);

  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    if (sockets.size >= LOCAL_LIMITS.maxClients) {
      socket.destroy();

      return;
    }

    sockets.add(socket);
    acceptLocalPeer(socket, options);
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);

    server.listen(options.path, () => {
      server.off('error', reject);
      resolve();
    });
  });

  await chmod(options.path, 0o600);
  const owned = await lstat(options.path);

  return {
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));

      await removeOwnedSocket(options.path, owned);
    },
  };
}
