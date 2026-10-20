import { ErrorCode } from '@protocol';
import { RedisConnectionStatus } from '../domain/infrastructure.js';
import { createHash } from 'node:crypto';
import { RedisCache, redisClient } from './redis.js';
import { RetentionQueue } from '../maintenance/retention-queue.js';
import { NotificationQueue } from '../notifications/queue.js';

export async function createMessaging(url: string, identity: string) {
  const client = redisClient(url);

  try {
    await client.connect();
  } catch {
    client.disconnect();
    throw new Error(ErrorCode.REDIS_UNAVAILABLE);
  }

  const prefix = 'claude-remote-' + createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const queue = new NotificationQueue(url, client, prefix);
  const retention = new RetentionQueue(url, client, prefix);

  return {
    prefix,
    cache: new RedisCache(client, prefix),
    queue,
    retention,
    async health() {
      if (client.status !== RedisConnectionStatus.Ready) {
        throw new Error(ErrorCode.REDIS_UNAVAILABLE);
      }

      await client.ping();
    },
    /** Closes both queues even when one fails, then the shared client; rethrows the first failure. */
    async close() {
      const results = await Promise.allSettled([retention.close(), queue.close()]);

      client.disconnect();

      const failures = results.flatMap((result) => ('reason' in result ? [result.reason as unknown] : []));

      if (failures.length) {
        throw failures[0];
      }
    },
  };
}

export type Messaging = Awaited<ReturnType<typeof createMessaging>>;
