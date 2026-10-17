import { expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RedisCache } from '../apps/server/src/infrastructure/redis.js';
import { PreferenceService } from '../apps/server/src/preferences/service.js';
import { databaseFixture } from './helpers/database.js';

it('serves preferences from Redis, isolates owners, and invalidates stale in-flight fills after changes', async () => {
  const fixture = await databaseFixture(),
    client = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380');

  let release!: () => void, loaded!: () => void;

  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      loaded = resolve;
    });

  let delay = true;

  class DelayedCache extends RedisCache {
    override rememberMutable<T>(
      key: string,
      parse: (value: unknown) => T,
      load: () => Promise<T>,
    ): Promise<T> {
      return super.rememberMutable(key, parse, async () => {
        const value = await load();

        if (delay) {
          delay = false;
          loaded();
          await gate;
        }

        return value;
      });
    }
  }

  try {
    await fixture.db.pool.query(
      "INSERT INTO users(id,telegram_id,created_at) VALUES('a','8801',0),('b','8802',0)",
    );

    const cache = new DelayedCache(client, 'preferences-' + randomUUID());

    expect(typeof RedisCache.prototype.rememberMutable).toBe('function');
    const service = new PreferenceService(fixture.db, cache);

    const a = { userId: 'a', telegramId: '8801' },
      b = { userId: 'b', telegramId: '8802' };

    const old = service.get(a);

    void old.catch(() => loaded());
    await ready;
    await service.update(a, { language: 'en', theme: 'dark' });
    expect(await service.get(a)).toEqual({ language: 'en', theme: 'dark' });
    release();
    await old;
    expect(await service.get(a)).toEqual({ language: 'en', theme: 'dark' });
    expect(await service.get(b)).toEqual({ language: null, theme: null });

    const unavailable = vi
      .spyOn(fixture.db.pool, 'query')
      .mockRejectedValue(new Error('DATABASE_UNAVAILABLE'));

    try {
      expect(await service.get(a)).toEqual({ language: 'en', theme: 'dark' });
    } finally {
      unavailable.mockRestore();
    }
  } finally {
    release();
    client.disconnect();
    await fixture.close();
  }
});
