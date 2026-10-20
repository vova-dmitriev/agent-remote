import { ServerErrorCode } from '../error-codes.js';
import { ErrorCode } from '@protocol';

import {
  NotificationBackoffType,
  RedisConnectionStatus,
  NotificationJobState,
} from '../domain/infrastructure.js';
import { Queue, Worker, DelayedError } from 'bullmq';
import { type Redis } from 'ioredis';
import { z } from 'zod';
import { type NotificationRepository } from './repositories/notifications.js';
import { redisClient } from '../infrastructure/redis.js';

const payload = z.strictObject({ outboxId: z.string().min(1).max(128) });

type Payload = z.infer<typeof payload>;

export class NotificationQueue {
  private queue: Queue<Payload>;
  private worker: Worker<Payload> | undefined;
  private workerRedis: Redis | undefined;
  private stopping = false;
  private deliveries = new Set<Promise<number>>();
  constructor(
    private url: string,
    private client: Redis,
    readonly prefix: string,
  ) {
    this.queue = new Queue<Payload>('notifications', {
      connection: client,
      prefix,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: NotificationBackoffType.Exponential, delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 1000 },
      },
    });

    this.queue.on('error', () => {}); // ignore: durable outbox reconciliation retries publication.
  }
  async enqueue(outboxId: string) {
    const data = payload.parse({ outboxId });

    if (this.client.status !== RedisConnectionStatus.Ready) {
      throw new Error(ErrorCode.REDIS_UNAVAILABLE);
    }

    await this.queue.add('notify', data, { jobId: outboxId });
  }
  async reconcile(outbox: NotificationRepository) {
    if (this.client.status !== RedisConnectionStatus.Ready) {
      return;
    }

    for (const id of await outbox.due(Date.now())) {
      const existing = await this.queue.getJob(id);
      const state = existing ? await existing.getState() : undefined;

      if (existing && (state === NotificationJobState.Failed || state === NotificationJobState.Completed)) {
        await existing.retry(state);
      } else {
        await this.enqueue(id);
      }
    }
  }
  async start(deliver: (id: string) => Promise<number>) {
    if (this.worker) {
      throw new Error(ServerErrorCode.WORKER_ALREADY_STARTED);
    }

    this.stopping = false;
    const connection = redisClient(this.url, true);

    this.workerRedis = connection;
    await connection.connect();

    this.worker = new Worker<Payload>(
      'notifications',
      async (job, token) => {
        if (this.stopping) {
          return;
        }

        const data = payload.parse(job.data);
        const pending = deliver(data.outboxId);

        this.deliveries.add(pending);
        let retryAfter: number;

        try {
          retryAfter = await pending;
        } finally {
          this.deliveries.delete(pending);
        }

        if (retryAfter > 0 && !this.stopping) {
          await job.moveToDelayed(Date.now() + retryAfter, token);
          throw new DelayedError();
        }
      },
      { connection, prefix: this.prefix, concurrency: 1, limiter: { max: 1, duration: 34 } },
    );

    this.worker.on('error', () => {}); // ignore: a reconnecting worker retains jobs in Redis.

    await this.worker.waitUntilReady();
  }
  async reserveChat(chatId: string): Promise<number> {
    if (this.client.status !== RedisConnectionStatus.Ready) {
      return 1000;
    }

    const result = await this.client.eval(
      "if redis.call('SET',KEYS[1],'1','PX',1000,'NX') then return 0 end return math.max(1,redis.call('PTTL',KEYS[1]))",
      1,
      `${this.prefix}:chat:${chatId}`,
    );

    return Number(result);
  }
  async stop() {
    const worker = this.worker;

    this.worker = undefined;
    this.stopping = true;

    try {
      await worker?.pause(true);
      await Promise.allSettled([...this.deliveries]);
      await worker?.close(true);
    } finally {
      this.workerRedis?.disconnect();
      this.workerRedis = undefined;
    }
  }
  async close() {
    await this.stop();
    await this.queue.close();
  }
}
