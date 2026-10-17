import { expect, it } from 'vitest';
import { databaseFixture } from './helpers/database.js';
import { SessionHistory } from '../apps/server/src/history/service.js';
import type { Principal } from '../apps/server/src/auth/security.js';

it('opens around a saved message and pages in both directions using source time, not import time', async () => {
  const fixture = await databaseFixture();

  try {
    await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','9999',0)");

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','g')",
    );

    await fixture.db.pool.query(
      "INSERT INTO sessions(owner_id,device_id,id,data) VALUES('owner','device','session','{}')",
    );

    for (let seq = 1; seq <= 240; seq++) {
      const event = {
        version: 1,
        deviceId: 'device',
        streamId: 'stream',
        seq,
        eventId: 'e' + seq,
        sessionId: 'session',
        occurredAt: 10000 - seq,
        type: 'message',
        payload: { id: 'm' + seq, role: 'assistant', text: 'Synthetic ' + seq, occurredAt: seq },
      };

      await fixture.db.pool.query(
        'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        ['owner', 'device', 'stream', seq, event.eventId, 'session', event.occurredAt, JSON.stringify(event)],
      );
    }

    const history = new SessionHistory(fixture.db),
      principal = { userId: 'owner' } as Principal;

    const recent = await history.page(principal, 'session');

    expect(recent.events.at(-1)?.payload).toMatchObject({ id: 'm240' });
    const saved = await history.page(principal, 'session', undefined, 'm120');

    expect(saved.events.some((event) => (event.payload as { id: string }).id === 'm120')).toBe(true);
    expect(saved.nextCursor).not.toBeNull();
    expect(saved.afterCursor).not.toBeNull();
    const newer = await history.page(principal, 'session', undefined, undefined, saved.afterCursor);

    expect((newer.events[0]?.payload as { occurredAt: number }).occurredAt).toBeGreaterThan(
      (saved.events.at(-1)?.payload as { occurredAt: number }).occurredAt,
    );

    await expect(
      history.page({ userId: 'stranger' } as Principal, 'session', undefined, 'm120'),
    ).rejects.toThrow('NOT_FOUND');
  } finally {
    await fixture.close();
  }
});
