import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { NotificationQueue } from '@server/notifications/queue.js';
import { redisProxy } from '../../helpers/relay/redis-proxy.js';

it('stops an active consumer when Redis disconnects after shutdown begins', async () => {
  const proxy = await redisProxy();
  const client = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380');
  const queue = new NotificationQueue(proxy.url, client, 'shutdown-' + randomUUID());
  let release!: () => void, entered!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });

  let stopping: Promise<void> | undefined;

  try {
    await queue.start(async () => {
      entered();
      await gate;

      return 0;
    });

    await queue.enqueue('in-flight');
    await started;
    stopping = queue.stop();
    proxy.offline();
    release();
    let stopped = false;

    void stopping.then(() => {
      stopped = true;
    });

    await expect.poll(() => stopped, { timeout: 1500 }).toBe(true);
  } finally {
    proxy.online();
    release();
    await stopping;
    await queue.close();
    client.disconnect();
    await proxy.close();
  }
});
