import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RedisCache } from '@server/infrastructure/redis.js';
import { ReadingPositionService } from '@server/reading-position/service.js';
import { ReadingPositionRepository } from '@server/reading-position/repository.js';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it('persists a bounded reading anchor and ignores delayed writes from an older visit', async () => {
  const f = await attachmentRelayFixture();
  const path = f.origin + `/sessions/${f.session.id}/reading-position`;
  const headers = { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' };
  const put = (body: unknown) => fetch(path, { method: 'PUT', headers, body: JSON.stringify(body) });

  try {
    const initial = await fetch(path, { headers });

    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ position: null });

    const position = {
      messageId: 'message-middle',
      offset: -183.25,
      cursor: 'position:opaque',
      updatedAt: Date.now(),
    };

    expect(await (await put(position)).json()).toEqual({ position });
    const newer = { ...position, messageId: 'next-message', offset: 19, updatedAt: position.updatedAt + 1 };

    expect(await (await put(newer)).json()).toEqual({ position: newer });

    expect(await (await put({ ...position, updatedAt: position.updatedAt - 1 })).json()).toEqual({
      position: newer,
    });

    expect(await (await fetch(path, { headers })).json()).toEqual({ position: newer });

    await f.database.db.pool.query('DELETE FROM sessions WHERE owner_id=$1 AND device_id=$2 AND id=$3', [
      f.principal.userId,
      f.deviceId,
      f.session.id,
    ]);

    await f.database.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
      f.principal.userId,
      f.deviceId,
      f.session.id,
      JSON.stringify(f.session),
    ]);

    expect(await (await fetch(path, { headers })).json()).toEqual({ position: newer });

    const rows = await f.database.db.pool.query(
      'SELECT message_id FROM reading_positions WHERE owner_id=$1 AND device_id=$2 AND session_id=$3',
      [f.principal.userId, f.deviceId, f.session.id],
    );

    expect(rows.rows).toEqual([{ message_id: newer.messageId }]);
  } finally {
    await f.close();
  }
});

it('rejects unauthenticated, foreign-owner, missing-session and revoked-device reads and writes', async () => {
  const f = await attachmentRelayFixture();
  const path = f.origin + `/sessions/${f.session.id}/reading-position`;
  const position = { messageId: 'middle', offset: 0, updatedAt: Date.now() };

  const request = (token: string, method: 'GET' | 'PUT', url = path) =>
    fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify(position) } : {}),
    });

  try {
    for (const method of ['GET', 'PUT'] as const) {
      expect((await request('invalid', method)).status).toBe(401);
      expect((await request(f.otherToken, method)).status).toBe(404);

      expect((await request(f.token, method, f.origin + '/sessions/missing/reading-position')).status).toBe(
        404,
      );
    }

    expect((await request(f.token, 'PUT')).status).toBe(200);
    await f.database.db.pool.query('UPDATE devices SET revoked_at=1 WHERE id=$1', [f.deviceId]);

    for (const method of ['GET', 'PUT'] as const) {
      expect((await request(f.token, method)).status).toBe(404);
    }

    const replacement = await f.seed(f.token);

    await f.database.db.pool.query('DELETE FROM sessions WHERE owner_id=$1 AND device_id=$2', [
      f.principal.userId,
      replacement.deviceId,
    ]);

    await f.database.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
      f.principal.userId,
      replacement.deviceId,
      f.session.id,
      JSON.stringify({ ...replacement.session, id: f.session.id }),
    ]);

    expect(await (await request(f.token, 'GET')).json()).toEqual({ position: null });
  } finally {
    await f.close();
  }
});

it('rejects malformed anchors, excessive offsets and future clocks without overwriting a valid bookmark', async () => {
  const f = await attachmentRelayFixture();
  const path = f.origin + `/sessions/${f.session.id}/reading-position`;
  const headers = { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' };
  const position = { messageId: 'middle', offset: 0, updatedAt: Date.now() };

  try {
    for (const bad of [
      { ...position, messageId: '' },
      { ...position, messageId: 'x'.repeat(513) },
      { ...position, offset: 1_000_000 },
      { ...position, offset: -1_000_000 },
      { ...position, cursor: 'x'.repeat(2049) },
      { ...position, updatedAt: -1 },
      { ...position, updatedAt: Date.now() + 120_000 },
      { ...position, ownerId: 'foreign' },
    ]) {
      expect((await fetch(path, { method: 'PUT', headers, body: JSON.stringify(bad) })).status).toBe(400);
    }

    expect(await (await fetch(path, { headers })).json()).toEqual({ position: null });
  } finally {
    await f.close();
  }
});

it('fences stale Redis fills, checks revocation before cache hits, and falls back to durable PostgreSQL', async () => {
  const f = await attachmentRelayFixture();
  const client = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380', { lazyConnect: true });

  let release!: () => void,
    loaded!: () => void,
    delay = true;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const ready = new Promise<void>((resolve) => {
    loaded = resolve;
  });

  class DelayedCache extends RedisCache {
    override rememberMutable<T>(key: string, validate: (value: unknown) => T, load: () => Promise<T>) {
      return super.rememberMutable(key, validate, async () => {
        const result = await load();

        if (delay) {
          delay = false;
          loaded();
          await gate;
        }

        return result;
      });
    }
  }

  try {
    await client.connect();

    const service = new ReadingPositionService(
      new ReadingPositionRepository(f.database.db),
      new DelayedCache(client, 'reading-test-' + randomUUID()),
    );

    const previous = service.get(f.principal, f.session.id);

    await ready;
    const position = { messageId: 'middle', offset: -22.5, updatedAt: Date.now() };

    expect(await service.update(f.principal, f.session.id, position)).toEqual({ position });
    expect(await service.get(f.principal, f.session.id)).toEqual({ position });
    release();
    await previous;
    expect(await service.get(f.principal, f.session.id)).toEqual({ position });
    const query = f.database.db.pool.query.bind(f.database.db.pool);

    const cacheOnly = vi.spyOn(f.database.db.pool, 'query').mockImplementation(((
      sql: unknown,
      ...args: unknown[]
    ) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT message_id,pixel_offset,cursor,updated_at FROM reading_positions')
      ) {
        throw new Error('UNEXPECTED_BOOKMARK_DATABASE_READ');
      }

      return (query as (...params: unknown[]) => unknown)(sql, ...args);
    }) as typeof f.database.db.pool.query);

    try {
      expect(await service.get(f.principal, f.session.id)).toEqual({ position });
    } finally {
      cacheOnly.mockRestore();
    }

    await f.database.db.pool.query('UPDATE devices SET revoked_at=1 WHERE id=$1', [f.deviceId]);
    await expect(service.get(f.principal, f.session.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      service.update(f.principal, f.session.id, { ...position, updatedAt: position.updatedAt + 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await f.database.db.pool.query('UPDATE devices SET revoked_at=NULL WHERE id=$1', [f.deviceId]);
    client.disconnect();
    expect(await service.get(f.principal, f.session.id)).toEqual({ position });

    expect(
      await new ReadingPositionService(new ReadingPositionRepository(f.database.db)).get(
        f.principal,
        f.session.id,
      ),
    ).toEqual({
      position,
    });
  } finally {
    release();
    client.disconnect();
    await f.close();
  }
});
