import { expect, it } from 'vitest';
import { attachmentRelayFixture } from './helpers/attachment-relay.js';
import { persistEvent } from '../apps/server/src/history/events.js';
import { HistoryRepository } from '../apps/server/src/history/repository.js';
import { SessionLabels } from '../apps/server/src/sessions/labels.js';
import { SessionRepository } from '../apps/server/src/sessions/repository.js';

it('uses native message time, ignores status polling and preserves the newest message after late history', async () => {
  const f = await attachmentRelayFixture();

  try {
    for (const [seq, type, occurredAt] of [
      [1, 'message', 100],
      [2, 'status', 900],
      [3, 'message', 50],
    ] as const) {
      await persistEvent(new HistoryRepository(f.database.db), f.principal.userId, {
        version: 1,
        deviceId: f.deviceId,
        sessionId: f.session.id,
        streamId: 'activity',
        seq,
        eventId: 'event-' + seq,
        type,
        occurredAt: 1000 + seq,
        payload: type === 'message' ? { id: 'm-' + seq, role: 'user', text: 'Synthetic', occurredAt } : {},
      });
    }

    const [session] = await new SessionLabels(new SessionRepository(f.database.db)).apply(
      f.principal,
      f.deviceId,
      [f.session],
    );

    expect(session?.lastMessageAt).toBe(100);

    const [native] = await new SessionLabels(new SessionRepository(f.database.db)).apply(
      f.principal,
      f.deviceId,
      [{ ...f.session, lastMessageAt: 40 }],
    );

    expect(native?.lastMessageAt).toBe(40);
  } finally {
    await f.close();
  }
});
