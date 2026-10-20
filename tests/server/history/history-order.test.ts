import { expect, it } from 'vitest';
import { databaseFixture } from '../../helpers/database.js';
import { SessionHistory } from '@server/history/service.js';
import { HistoryRepository } from '@server/history/repository.js';
import type { Principal } from '@server/auth/security.js';

it('preserves source sequence across page boundaries when timestamps tie and random IDs disagree', async () => {
  const fixture = await databaseFixture();

  try {
    await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','9999',0)");

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','g')",
    );

    await fixture.db.pool.query(
      "INSERT INTO sessions(owner_id,device_id,id,data) VALUES('owner','device','session','{}')",
    );

    for (let seq = 1; seq <= 105; seq++) {
      const eventId = 'event-' + String(106 - seq).padStart(4, '0');

      const event = {
        version: 1,
        deviceId: 'device',
        streamId: 'stream',
        seq,
        eventId,
        sessionId: 'session',
        occurredAt: 42,
        type: 'message',
        payload: { id: String(seq), role: 'assistant', text: 'Synthetic ' + seq, occurredAt: 42 },
      };

      await fixture.db.pool.query(
        'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        ['owner', 'device', 'stream', seq, eventId, 'session', 42, JSON.stringify(event)],
      );
    }

    const history = new SessionHistory(new HistoryRepository(fixture.db));
    const principal = { userId: 'owner' } as Principal;
    const first = await history.page(principal, 'session');

    expect(first.events.map((event) => event.seq)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 6),
    );

    expect(first.nextCursor).not.toBeNull();
    const second = await history.page(principal, 'session', first.nextCursor);

    expect(second.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(second.nextCursor).toBeNull();
    const legacy = Buffer.from(JSON.stringify({ at: 42, id: 'event-0050' })).toString('base64url');

    expect((await history.page(principal, 'session', legacy)).events.length).toBeGreaterThan(0);
  } finally {
    await fixture.close();
  }
});
