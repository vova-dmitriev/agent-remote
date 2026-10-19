import { EventType, historySchema, type EventEnvelope } from '@protocol';
import { type HistoryRepository } from './repository.js';
import { hash } from '../auth/security.js';

export function eventNotificationId(ownerId: string, event: EventEnvelope): string | null {
  return event.occurredAt >= Date.now() - 60_000 &&
    [EventType.TurnEnd, EventType.Permission].some((candidateValue) => candidateValue === event.type)
    ? hash(ownerId + ':' + event.eventId)
    : null;
}

export async function persistEvent(
  history: HistoryRepository,
  ownerId: string,
  event: EventEnvelope,
): Promise<boolean> {
  return history.transaction(async (tx) => {
    if (!(await history.insertEvent(tx, ownerId, event))) {
      return false;
    }

    await history.bumpRevision(tx, ownerId, event.deviceId);

    const message = event.type === EventType.Message ? historySchema.safeParse(event.payload) : null;

    if (event.sessionId && message?.success) {
      await history.recordActivity(tx, ownerId, event.deviceId, event.sessionId, message.data.occurredAt);
    }

    const notificationId = eventNotificationId(ownerId, event);

    if (notificationId) {
      await history.recordNotification(tx, notificationId, ownerId, event.sessionId, event.type, Date.now());
    }

    return true;
  });
}
