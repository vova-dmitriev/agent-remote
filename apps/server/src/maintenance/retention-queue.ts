import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { redisClient } from '../infrastructure/redis.js';
import { RETENTION_INTERVAL_MS, RETENTION_JOB_ID, RETENTION_QUEUE } from './limits.js';

/** Finished retention jobs kept in Redis for inspection. */
const RETENTION_JOBS_KEPT = 10;

/**
 * Runs retention from a BullMQ job scheduler. Every relay upserts the same scheduler id and runs a worker,
 * so each interval produces one job and exactly one relay runs it.
 */
export class RetentionQueue {
  private readonly queue: Queue;
  private worker: Worker | undefined;
  private workerRedis: Redis | undefined;
  constructor(
    private readonly url: string,
    client: Redis,
    private readonly prefix: string,
  ) {
    this.queue = new Queue(RETENTION_QUEUE, { connection: client, prefix });

    this.queue.on('error', () => {}); // ignore: the scheduler survives a Redis outage; the next interval runs again.
  }
  async start(run: () => Promise<unknown>) {
    if (this.worker) {
      return;
    }

    await this.queue.upsertJobScheduler(
      RETENTION_JOB_ID,
      { every: RETENTION_INTERVAL_MS },
      {
        name: RETENTION_JOB_ID,
        opts: { removeOnComplete: RETENTION_JOBS_KEPT, removeOnFail: RETENTION_JOBS_KEPT },
      },
    );

    const connection = redisClient(this.url, true);

    this.workerRedis = connection;
    await connection.connect();

    this.worker = new Worker(RETENTION_QUEUE, () => run(), {
      connection,
      prefix: this.prefix,
      concurrency: 1,
    });

    this.worker.on('error', () => {}); // ignore: a reconnecting worker picks up the next scheduled job.

    await this.worker.waitUntilReady();
  }
  async stop() {
    const worker = this.worker;

    this.worker = undefined;

    try {
      await worker?.close();
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
