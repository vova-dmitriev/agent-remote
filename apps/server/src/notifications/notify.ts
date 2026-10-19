import { Inject, Injectable } from '@nestjs/common';
import { MESSAGING } from '../app/relay-config.js';
import { hash } from '../auth/security.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { NotificationRepository } from './repositories/notifications.js';

/** Records a notification in the PostgreSQL outbox once per owner and key, then wakes the delivery queue. */
@Injectable()
export class Notifier {
  constructor(
    @Inject(NotificationRepository) private readonly outbox: NotificationRepository,
    @Inject(MESSAGING) private readonly messaging: Messaging | undefined,
  ) {}

  readonly notify = async (owner: string, key: string, kind: string, sessionId: string | null = null) => {
    const { outbox, messaging } = this;
    const id = hash(owner + ':' + key);

    await outbox.record(id, owner, sessionId, kind, Date.now());

    void messaging?.queue.enqueue(id).catch(() => {
      /* PostgreSQL outbox is reconciled by the worker. */
    });
  };
}
