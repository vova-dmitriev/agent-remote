import { RedisConnectionStatus } from '../domain/infrastructure.js';
import {
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_RETRY_MAX_DELAY_MS,
  REDIS_RETRY_DELAY_STEP_MS,
  REDIS_CACHE_TTL_MS,
  REDIS_MAX_CACHE_ENTRY_BYTES,
} from './redis-limits.js';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

export function redisClient(url: string, worker = false): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    ...(worker ? {} : { commandTimeout: REDIS_COMMAND_TIMEOUT_MS }),
    retryStrategy: (attempt) => Math.min(REDIS_RETRY_MAX_DELAY_MS, attempt * REDIS_RETRY_DELAY_STEP_MS),
  });

  client.on('error', () => {}); // ignore: callers handle failures without logging connection credentials.

  return client;
}

export class RedisCache {
  constructor(
    private client: Redis,
    private prefix: string,
    private ttlMs = REDIS_CACHE_TTL_MS,
  ) {}
  async rememberMutable<T>(key: string, validate: (value: unknown) => T, load: () => Promise<T>): Promise<T> {
    const cacheKey = `${this.prefix}:mutable:${key}`,
      revisionKey = cacheKey + ':revision';

    let revision: string | null | undefined;

    try {
      if (this.client.status === RedisConnectionStatus.Ready) {
        const [cached, version] = await this.client.mget(cacheKey, revisionKey);

        revision = version ?? null;

        if (cached && Buffer.byteLength(cached) <= REDIS_MAX_CACHE_ENTRY_BYTES) {
          return validate(JSON.parse(cached));
        }
      }
    } catch {} // ignore: read from PostgreSQL when the cache is unavailable or corrupt.

    const value = await load();

    try {
      if (revision !== undefined && this.client.status === RedisConnectionStatus.Ready) {
        await this.client.eval(
          "if (redis.call('GET',KEYS[2]) or '') == ARGV[1] then return redis.call('SET',KEYS[1],ARGV[2],'PX',ARGV[3]) end",
          2,
          cacheKey,
          revisionKey,
          revision ?? '',
          JSON.stringify(value),
          this.ttlMs,
        );
      }
    } catch {} // ignore: cache writes do not change the authoritative response.

    return value;
  }
  async invalidateMutable(key: string): Promise<void> {
    const cacheKey = `${this.prefix}:mutable:${key}`;

    try {
      if (this.client.status === RedisConnectionStatus.Ready) {
        await this.client.eval(
          "redis.call('SET',KEYS[2],ARGV[1]); return redis.call('DEL',KEYS[1])",
          2,
          cacheKey,
          cacheKey + ':revision',
          randomUUID(),
        );
      }
    } catch {} // ignore: PostgreSQL remains authoritative during a Redis outage.
  }
  async remember<T>(key: string, validate: (value: unknown) => T, load: () => Promise<T>): Promise<T> {
    const cacheKey = `${this.prefix}:cache:${key}`;

    try {
      if (this.client.status === RedisConnectionStatus.Ready) {
        const cached = await this.client.get(cacheKey);

        if (cached && Buffer.byteLength(cached) <= REDIS_MAX_CACHE_ENTRY_BYTES) {
          return validate(JSON.parse(cached));
        }
      }
    } catch {} // ignore: corrupt or unavailable cache falls back to the authoritative source.

    const value = await load();

    try {
      const encoded = JSON.stringify(value);

      if (
        this.client.status === RedisConnectionStatus.Ready &&
        Buffer.byteLength(encoded) <= REDIS_MAX_CACHE_ENTRY_BYTES
      ) {
        await this.client.set(cacheKey, encoded, 'PX', this.ttlMs);
      }
    } catch {} // ignore: a failed cache write must not fail an otherwise authorized read.

    return value;
  }
}
