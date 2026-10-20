import { expect, it } from 'vitest';
import { attachmentRelayFixture } from './helpers/attachment-relay.js';
import { SessionLabels } from '../apps/server/src/sessions/labels.js';
import { SessionRepository } from '../apps/server/src/sessions/repository.js';

it('persists an owned label across native snapshots and rejects another owner or an obsolete generation', async () => {
  const f = await attachmentRelayFixture();

  try {
    const labels = new SessionLabels(new SessionRepository(f.database.db));

    await expect(
      labels.rename(await f.relay.auth.authenticate(f.otherToken), f.session.id, {
        title: 'Other',
        generation: f.session.generation,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      labels.rename(f.principal, f.session.id, { title: 'Old', generation: 'old' }),
    ).rejects.toMatchObject({ code: 'STALE_SESSION' });

    await labels.rename(f.principal, f.session.id, {
      title: '  Parser review  ',
      generation: f.session.generation,
    });

    const sessions = await new SessionLabels(new SessionRepository(f.database.db)).apply(
      f.principal,
      f.deviceId,
      [{ ...f.session, title: 'Native original title' }],
    );

    expect(sessions[0]?.title).toBe('Parser review');

    await expect(
      labels.rename(f.principal, f.session.id, { title: ' ', generation: f.session.generation }),
    ).rejects.toThrow();

    await f.database.db.pool.query('UPDATE devices SET revoked_at=1 WHERE id=$1', [f.deviceId]);

    await expect(
      labels.rename(f.principal, f.session.id, { title: 'Revoked', generation: f.session.generation }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  } finally {
    await f.close();
  }
});

it('orders server snapshots by actual last message time, independently of status and heartbeat time', async () => {
  const f = await attachmentRelayFixture();

  try {
    const ordered = await new SessionLabels(new SessionRepository(f.database.db)).apply(
      f.principal,
      f.deviceId,
      [
        { ...f.session, id: 'old', lastMessageAt: 10, lastEventAt: 999999, status: 'running' },
        { ...f.session, id: 'latest', lastMessageAt: 30, lastEventAt: 1, status: 'unknown' },
        { ...f.session, id: 'middle', lastMessageAt: 20, lastEventAt: 2 },
      ],
    );

    expect(ordered.map((session) => session.id)).toEqual(['latest', 'middle', 'old']);
  } finally {
    await f.close();
  }
});
