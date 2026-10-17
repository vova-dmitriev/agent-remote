import { EventType, historySchema, type EventEnvelope } from '../../../../packages/protocol/src/index.js';
import { type Database } from '../db/database.js';
import { hash } from '../auth/security.js';

export function eventNotificationId(ownerId: string, event: EventEnvelope): string | null {
  return event.occurredAt >= Date.now() - 60_000 &&
    [EventType.TurnEnd, EventType.Permission].some((candidateValue) => candidateValue === event.type)
    ? hash(ownerId + ':' + event.eventId)
    : null;
}

export async function persistEvent(db: Database, ownerId: string, event: EventEnvelope): Promise<boolean> {
  return db.transaction(async (tx) => {
    const saved = await tx.query(
      'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING seq',
      [
        ownerId,
        event.deviceId,
        event.streamId,
        event.seq,
        event.eventId,
        event.sessionId,
        event.occurredAt,
        JSON.stringify(event),
      ],
    );

    if (!saved.rowCount) {
      return false;
    }

    await tx.query('UPDATE devices SET history_revision=history_revision+1 WHERE owner_id=$1 AND id=$2', [
      ownerId,
      event.deviceId,
    ]);

    const message = event.type === EventType.Message ? historySchema.safeParse(event.payload) : null;

    if (event.sessionId && message?.success) {
      await tx.query(
        'INSERT INTO session_activity(owner_id,device_id,session_id,last_message_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,device_id,session_id) DO UPDATE SET last_message_at=greatest(session_activity.last_message_at,EXCLUDED.last_message_at)',
        [ownerId, event.deviceId, event.sessionId, message.data.occurredAt],
      );
    }

    const notificationId = eventNotificationId(ownerId, event);

    if (notificationId) {
      await tx.query(
        'INSERT INTO notification_outbox(id,owner_id,session_id,kind,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT DO NOTHING',
        [notificationId, ownerId, event.sessionId, event.type, Date.now()],
      );
    }

    return true;
  });
}
