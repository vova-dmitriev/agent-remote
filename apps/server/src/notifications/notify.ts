import { Inject, Injectable } from '@nestjs/common';
import { MESSAGING } from '../app/relay-config.js';
import { hash } from '../auth/security.js';
import { Database } from '../db/database.js';
import type { Messaging } from '../infrastructure/messaging.js';

/** Records a notification in the PostgreSQL outbox once per owner and key, then wakes the delivery queue. */
@Injectable()
export class Notifier {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MESSAGING) private readonly messaging: Messaging | undefined,
  ) {}

  readonly notify = async (owner: string, key: string, kind: string, sessionId: string | null = null) => {
    const { db, messaging } = this;
    const id = hash(owner + ':' + key);

    await db.pool.query(
      'INSERT INTO notification_outbox(id,owner_id,session_id,kind,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT DO NOTHING',
      [id, owner, sessionId, kind, Date.now()],
    );

    void messaging?.queue.enqueue(id).catch(() => {
      /* PostgreSQL outbox is reconciled by the worker. */
    });
  };
}
