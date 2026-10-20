import { expect, it } from 'vitest';
import { databaseFixture } from '../../helpers/database.js';
import { persistEvent } from '../../../apps/server/src/history/events.js';
import { HistoryRepository } from '../../../apps/server/src/history/repository.js';
import type { EventEnvelope } from '@protocol';

it('rolls back the event and revision if notification intent cannot be persisted, then retries once', async () => {
  const fixture = await databaseFixture();

  try {
    await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','8801',0)");

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','g')",
    );

    await fixture.db.pool.query(
      "CREATE FUNCTION reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END; $$",
    );

    await fixture.db.pool.query(
      'CREATE TRIGGER reject_outbox BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION reject_outbox()',
    );

    const event: EventEnvelope = {
      version: 1,
      deviceId: 'device',
      streamId: 'stream',
      seq: 1,
      eventId: 'permission',
      sessionId: 'session',
      type: 'permission',
      occurredAt: Date.now(),
      payload: {},
    };

    // The query builder keeps the database error as `cause`.
    await expect(persistEvent(new HistoryRepository(fixture.db), 'owner', event)).rejects.toSatisfy(
      (error: unknown) =>
        String((error as { cause?: { message?: unknown } }).cause?.message).includes(
          'synthetic outbox failure',
        ),
    );

    expect((await fixture.db.pool.query('SELECT count(*) FROM events')).rows[0].count).toBe('0');

    expect(
      (await fixture.db.pool.query('SELECT history_revision FROM devices')).rows[0].history_revision,
    ).toBe('0');

    await fixture.db.pool.query('DROP TRIGGER reject_outbox ON notification_outbox');
    expect(await persistEvent(new HistoryRepository(fixture.db), 'owner', event)).toBe(true);
    expect(await persistEvent(new HistoryRepository(fixture.db), 'owner', event)).toBe(false);

    expect((await fixture.db.pool.query('SELECT owner_id,sent FROM notification_outbox')).rows).toEqual([
      { owner_id: 'owner', sent: false },
    ]);
  } finally {
    await fixture.close();
  }
});
