import { afterAll, beforeAll, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { NotificationQueue } from '../../../apps/server/src/notifications/queue.js';
import { NotificationRepository } from '../../../apps/server/src/notifications/repositories/notifications.js';
import { redisClient } from '../../../apps/server/src/infrastructure/redis.js';
import { databaseFixture } from '../../helpers/database.js';

const url = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380';
const client = redisClient(url);
const prefix = 'queue-test-' + randomUUID();
let broker: NotificationQueue;
let fixture: Awaited<ReturnType<typeof databaseFixture>>;

beforeAll(async () => {
  await client.connect();
  fixture = await databaseFixture();
  broker = new NotificationQueue(url, client, prefix);
});

afterAll(async () => {
  await broker?.close();
  client.disconnect();
  await fixture?.close();
});

it('delivers one stable outbox job despite duplicate publications and honors retry delay', async () => {
  const delivered: Array<{ id: string; at: number }> = [];

  await broker.start(async (id) => {
    delivered.push({ id, at: Date.now() });

    return delivered.length === 1 ? 100 : 0;
  });

  await Promise.all([broker.enqueue('outbox-one'), broker.enqueue('outbox-one')]);
  await expect.poll(() => delivered.length).toBe(2);
  expect(delivered.map((value) => value.id)).toEqual(['outbox-one', 'outbox-one']);
  expect(delivered[1]!.at - delivered[0]!.at).toBeGreaterThanOrEqual(90);
  const raw = new Redis(url);

  try {
    const jobs = await raw.keys(`${prefix}:notifications:*`);

    const payloads = await Promise.all(
      jobs.map((key) => raw.type(key).then(async (type) => (type === 'hash' ? raw.hget(key, 'data') : null))),
    );

    expect(payloads.filter(Boolean)).toEqual(['{"outboxId":"outbox-one"}']);
  } finally {
    raw.disconnect();
  }
});

it('recovers eligible unsent outbox records that were never published to Redis', async () => {
  await broker.stop();

  await fixture.db.pool.query(
    "INSERT INTO users(id,telegram_id,created_at,private_chat_id) VALUES('owner','7001',0,'7001')",
  );

  await fixture.db.pool.query(
    "INSERT INTO notification_outbox(id,owner_id,kind,created_at,next_attempt_at) VALUES('recovered','owner','permission',0,0)",
  );

  const delivered: string[] = [];

  await broker.start(async (id) => {
    delivered.push(id);

    return 0;
  });

  await broker.reconcile(new NotificationRepository(fixture.db));
  await expect.poll(() => delivered).toContain('recovered');
  const inspect = new Queue('notifications', { connection: client, prefix });

  try {
    await expect.poll(async () => (await inspect.getJob('recovered'))?.getState()).toBe('completed');
    await broker.reconcile(new NotificationRepository(fixture.db));
    await expect.poll(() => delivered.filter((id) => id === 'recovered').length).toBe(2);
  } finally {
    await inspect.close();
  }
});
