import { createServer, connect, type Socket } from 'node:net';

export async function redisProxy() {
  const upstream = new URL(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380');
  const sockets = new Set<Socket>();
  let offline = false;

  const server = createServer((socket) => {
    if (offline) {
      socket.destroy();

      return;
    }

    const target = connect(Number(upstream.port || 6379), upstream.hostname);

    for (const current of [socket, target]) {
      sockets.add(current);
      current.on('error', () => {});

      current.on('close', () => {
        sockets.delete(current);
        socket.destroy();
        target.destroy();
      });
    }

    socket.pipe(target).pipe(socket);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('PROXY_LISTEN_FAILED');
  }

  const url = new URL(upstream);

  url.hostname = '127.0.0.1';
  url.port = String(address.port);

  return {
    url: url.href,
    offline() {
      offline = true;

      for (const socket of sockets) {
        socket.destroy();
      }
    },
    online() {
      offline = false;
    },
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
