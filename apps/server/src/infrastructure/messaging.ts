import { RedisConnectionStatus } from '../domain/infrastructure.js';
import { createHash } from 'node:crypto';
import { RedisCache, redisClient } from './redis.js';
import { NotificationQueue } from '../notifications/queue.js';

export async function createMessaging(url: string, identity: string) {
  const client = redisClient(url);

  try {
    await client.connect();
  } catch {
    client.disconnect();
    throw new Error('REDIS_UNAVAILABLE');
  }

  const prefix = 'claude-remote-' + createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const queue = new NotificationQueue(url, client, prefix);

  return {
    prefix,
    cache: new RedisCache(client, prefix),
    queue,
    async health() {
      if (client.status !== RedisConnectionStatus.Ready) {
        throw new Error('REDIS_UNAVAILABLE');
      }

      await client.ping();
    },
    async close() {
      try {
        await queue.close();
      } finally {
        client.disconnect();
      }
    },
  };
}
