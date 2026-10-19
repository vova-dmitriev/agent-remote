import { CommandStatus, ErrorCode } from '@protocol';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createRelay } from '../apps/server/src/app/create-relay.js';
import { AttachmentRepository } from '../apps/server/src/attachments/repositories/attachments.js';
import { CommandRepository } from '../apps/server/src/commands/repositories/audit.js';
import { HistoryRepository } from '../apps/server/src/history/repository.js';
import {
  COMMAND_ACK_TIMEOUT_MS,
  EVENT_RETENTION_MS,
  EVENTS_PER_DEVICE,
  RETENTION_BATCH,
  RETENTION_INTERVAL_MS,
  RETENTION_JOB_ID,
  RETENTION_QUEUE,
} from '../apps/server/src/maintenance/limits.js';
import { Retention } from '../apps/server/src/maintenance/retention.js';
import { databaseFixture } from './helpers/database.js';
import { testBotToken } from './helpers/telegram.js';

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function seededDatabase(now: number) {
  const fixture = await databaseFixture();
  const { db } = fixture;
  const owners = { busy: randomUUID(), quiet: randomUUID() };

  cleanups.push(() => fixture.close());

  for (const [device, owner] of Object.entries(owners)) {
    await db.pool.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,1)', [owner, device]);

    await db.pool.query("INSERT INTO devices(id,owner_id,token_hash,generation) VALUES($1,$2,$3,'g')", [
      device,
      owner,
      device + '-token',
    ]);
  }

  // 22 000 recent events on one device: occurred_at grows with seq, so seq 12 001..22 000 are the newest.
  await db.pool.query(
    "INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,occurred_at,data) SELECT $1,'busy','s',n,'busy-'||n,$2::bigint+n,'{}' FROM generate_series(1,22000) n",
    [owners.busy, now - 3_600_000],
  );

  // Three events older than the retention window and two recent ones on another device.
  await db.pool.query(
    "INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,occurred_at,data) SELECT $1,'quiet','s',n,'quiet-'||n,CASE WHEN n<=3 THEN $2::bigint ELSE $3::bigint END,'{}' FROM generate_series(1,5) n",
    [owners.quiet, now - EVENT_RETENTION_MS - 1, now - 1_000],
  );

  for (const [command, status, createdAt] of [
    ['stale', CommandStatus.Accepted, now - COMMAND_ACK_TIMEOUT_MS - 1],
    ['fresh', CommandStatus.Accepted, now - 1_000],
    ['expired', CommandStatus.Dispatched, now - EVENT_RETENTION_MS - 1],
  ] as const) {
    await db.pool.query(
      "INSERT INTO command_audit(owner_id,command_id,device_id,session_id,action,fingerprint,status,created_at) VALUES($1,$2,'quiet','s','prompt','f',$3,$4)",
      [owners.quiet, command, status, createdAt],
    );
  }

  return { db };
}

it('deletes old and surplus events in batches and keeps the newest events of every device', async () => {
  const now = Date.now();
  const { db } = await seededDatabase(now);
  const spy = vi.spyOn(db.pool, 'query');

  await new Retention(new HistoryRepository(db), new CommandRepository(db), new AttachmentRepository(db)).run(
    now,
  );

  const deletes = spy.mock.calls.filter(
    ([sql]) => typeof sql === 'string' && sql.startsWith('DELETE FROM events'),
  );

  const surplus = deletes.filter(
    ([sql, values]) => String(sql).includes('OFFSET') && (values as unknown[])[0] === 'busy',
  );

  // 12 000 surplus rows on the busy device go 5 000, 5 000, 2 000; an empty batch ends the loop.
  expect(surplus).toHaveLength(4);
  expect(deletes.every(([, values]) => (values as unknown[]).at(-1) === RETENTION_BATCH)).toBe(true);

  const busy = await db.pool.query(
    "SELECT count(*)::int AS count,min(seq)::int AS oldest FROM events WHERE device_id='busy'",
  );

  expect(busy.rows[0]).toEqual({ count: EVENTS_PER_DEVICE, oldest: 22_000 - EVENTS_PER_DEVICE + 1 });

  const quiet = await db.pool.query("SELECT seq::int FROM events WHERE device_id='quiet' ORDER BY seq");

  expect(quiet.rows.map((row) => row.seq)).toEqual([4, 5]);

  const commands = await db.pool.query(
    'SELECT command_id,status,code FROM command_audit ORDER BY command_id',
  );

  expect(commands.rows).toEqual([
    { command_id: 'fresh', status: CommandStatus.Accepted, code: null },
    { command_id: 'stale', status: CommandStatus.Unknown, code: ErrorCode.ACK_TIMEOUT },
  ]);
});

it('schedules retention once in Redis however many relays share it', async () => {
  const fixture = await databaseFixture();
  const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380';

  cleanups.push(() => fixture.close());

  const start = () =>
    createRelay({
      databaseUrl: fixture.url,
      schema: fixture.schema,
      redisUrl,
      botToken: testBotToken,
      publicOrigin: 'http://127.0.0.1:4173',
    });

  const first = await start();

  cleanups.push(() => first.close());
  const second = await start();

  cleanups.push(() => second.close());

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(RETENTION_QUEUE, { connection, prefix: first.messaging!.prefix });

  cleanups.push(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
  });

  const schedulers = await queue.getJobSchedulers();

  expect(schedulers).toHaveLength(1);
  expect(schedulers[0]).toMatchObject({ key: RETENTION_JOB_ID, every: RETENTION_INTERVAL_MS });

  // The scheduler's first job runs at once on one of the two relays.
  await expect.poll(() => queue.getCompletedCount(), { timeout: 5_000 }).toBe(1);
});
