import { expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { databaseFixture } from './helpers/database.js';
import { RedisCache } from '../apps/server/src/infrastructure/redis.js';
import { SessionHistory } from '../apps/server/src/history/service.js';
import { persistEvent } from '../apps/server/src/history/events.js';
import type { EventEnvelope } from '@protocol';

it('cannot let an old in-flight history fill overwrite a newer committed revision', async () => {
  const fixture = await databaseFixture();
  const client = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380');

  let release!: () => void,
    loaded!: () => void,
    first = true;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const ready = new Promise<void>((resolve) => {
    loaded = resolve;
  });

  class DelayedCache extends RedisCache {
    override remember<T>(key: string, validate: (value: unknown) => T, load: () => Promise<T>): Promise<T> {
      return super.remember(key, validate, async () => {
        const value = await load();

        if (first) {
          first = false;
          loaded();
          await gate;
        }

        return value;
      });
    }
  }

  try {
    await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','8901',0)");

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','g')",
    );

    await fixture.db.pool.query(
      "INSERT INTO sessions(owner_id,device_id,id,data) VALUES('owner','device','session','{}')",
    );

    const event = (seq: number): EventEnvelope => ({
      version: 1,
      deviceId: 'device',
      streamId: 'stream',
      seq,
      eventId: String(seq),
      sessionId: 'session',
      occurredAt: Date.now(),
      type: 'message',
      payload: {},
    });

    const history = new SessionHistory(fixture.db, new DelayedCache(client, 'race-' + randomUUID()));
    const principal = { userId: 'owner', telegramId: '8901' };

    await persistEvent(fixture.db, 'owner', event(1));
    const old = history.page(principal, 'session');

    await ready;
    await persistEvent(fixture.db, 'owner', event(2));
    expect((await history.page(principal, 'session')).events).toHaveLength(2);
    release();
    expect((await old).events).toHaveLength(1);
    expect((await history.page(principal, 'session')).events).toHaveLength(2);
  } finally {
    release();
    client.disconnect();
    await fixture.close();
  }
});
