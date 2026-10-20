import { afterAll, beforeAll, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { createRelay } from '../../../apps/server/src/app/create-relay.js';
import { NotificationWorker } from '../../../apps/server/src/notifications/worker.js';
import { databaseFixture } from '../../helpers/database.js';
import { redisProxy } from '../../helpers/redis-proxy.js';
import { testBotToken, initData } from '../../helpers/telegram.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let proxy: Awaited<ReturnType<typeof redisProxy>>;
let relay: Awaited<ReturnType<typeof createRelay>>;
let worker: NotificationWorker;
let owner: string;
const sent: Array<{ chat_id: string; text: string }> = [];

const fetcher: typeof fetch = async (url, options) => {
  if (String(url).endsWith('/sendMessage')) {
    sent.push(JSON.parse(String(options?.body)) as { chat_id: string; text: string });

    return Response.json({ ok: true, result: { message_id: sent.length } });
  }

  await new Promise((resolve) => setTimeout(resolve, 20));

  return Response.json({ ok: true, result: [] });
};

beforeAll(async () => {
  fixture = await databaseFixture();
  proxy = await redisProxy();

  relay = await createRelay({
    databaseUrl: fixture.url,
    schema: fixture.schema,
    redisUrl: proxy.url,
    botToken: testBotToken,
    publicOrigin: 'http://127.0.0.1:4173',
  });

  owner = (await relay.auth.authenticate((await relay.auth.login(initData('7003'))).token)).userId;

  worker = new NotificationWorker(
    relay.db,
    testBotToken,
    'https://example.invalid',
    fetcher,
    relay.messaging!.queue,
  );

  await worker.updates([
    { update_id: 1, message: { text: '/start', from: { id: 7003 }, chat: { id: 7003, type: 'private' } } },
  ]);

  await worker.start();
});

afterAll(async () => {
  proxy?.online();
  await worker?.close();
  await relay?.close();
  await proxy?.close();
  await fixture?.close();
});

it('persists intent during Redis disconnection and delivers after reconnect without exposing messages in jobs', async () => {
  proxy.offline();

  await expect
    .poll(
      () =>
        relay.messaging!.health().then(
          () => true,
          () => false,
        ),
      { timeout: 5000 },
    )
    .toBe(false);

  await relay.notify(owner, 'during-outage', 'permission', 'synthetic-session');
  const rows = await relay.db.pool.query('SELECT sent FROM notification_outbox');

  expect(rows.rows).toEqual([{ sent: false }]);
  expect(sent).toHaveLength(0);
  proxy.online();
  await expect.poll(() => sent.length, { timeout: 5000 }).toBe(1);
  expect(sent[0]).toMatchObject({ chat_id: '7003', text: 'An agent is asking for permission.' });

  await expect
    .poll(async () => (await relay.db.pool.query('SELECT sent FROM notification_outbox')).rows[0].sent)
    .toBe(true);
});

it('reconstructs missing Redis queue data from the PostgreSQL outbox', async () => {
  await worker.close();
  await relay.notify(owner, 'queue-loss', 'turn_end', 'synthetic-session');
  const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380');

  try {
    const keys = await redis.keys(relay.messaging!.prefix + ':*');

    if (keys.length) {
      await redis.del(...keys);
    }

    expect(await redis.keys(relay.messaging!.prefix + ':*')).toEqual([]);
  } finally {
    redis.disconnect();
  }

  worker = new NotificationWorker(
    relay.db,
    testBotToken,
    'https://example.invalid',
    fetcher,
    relay.messaging!.queue,
  );

  await worker.start();
  await expect.poll(() => sent.length, { timeout: 5000 }).toBe(2);

  expect(sent[1]).toMatchObject({
    chat_id: '7003',
    text: 'The request finished. Open the session to check the result.',
  });
});
