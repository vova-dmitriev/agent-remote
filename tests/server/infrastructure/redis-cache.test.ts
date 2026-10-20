import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { RedisCache } from '@server/infrastructure/redis.js';

const url = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380';
const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
const prefix = 'cache-test-' + randomUUID();

beforeAll(async () => {
  await client.connect();
});

afterAll(() => {
  client.disconnect();
});

const parse = (value: unknown) => z.object({ text: z.string() }).parse(value);

it('loads once, uses a validated Redis cache hit, and separates keys', async () => {
  const cache = new RedisCache(client, prefix);
  let loads = 0;
  const load = async () => ({ text: String(++loads) });

  expect(await cache.remember('owner-a', parse, load)).toEqual({ text: '1' });
  expect(await cache.remember('owner-a', parse, load)).toEqual({ text: '1' });
  expect(await cache.remember('owner-b', parse, load)).toEqual({ text: '2' });
  expect(loads).toBe(2);
});

it('expires data and reloads malformed cached values', async () => {
  const cache = new RedisCache(client, prefix, 40);

  await cache.remember('expiring', parse, async () => ({ text: 'old' }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(await cache.remember('expiring', parse, async () => ({ text: 'new' }))).toEqual({ text: 'new' });
  await client.set(`${prefix}:cache:corrupt`, '{"wrong":"shape"}');
  expect(await cache.remember('corrupt', parse, async () => ({ text: 'safe' }))).toEqual({ text: 'safe' });
});

it('falls back to the source when Redis is disconnected', async () => {
  const unavailable = new Redis(url, { lazyConnect: true, enableOfflineQueue: false });

  unavailable.disconnect();
  const cache = new RedisCache(unavailable, prefix);

  expect(await cache.remember('fallback', parse, async () => ({ text: 'database' }))).toEqual({
    text: 'database',
  });
});
