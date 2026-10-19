import { FrameType, type Cursor, type EventEnvelope } from '@protocol';
import { type LocalStore } from './store.js';

/** Only server acknowledgements advance durable progress; omitted sessions never consume a batch. */
export class EventReplay {
  private cursor: Cursor;
  constructor(
    private store: LocalStore,
    private sessions: () => ReadonlySet<string>,
    private send: (event: EventEnvelope) => boolean,
  ) {
    this.cursor = store.acknowledgedCursor();
  }
  flush() {
    let events = this.store.replayForSessions(this.cursor, this.sessions());

    if (events === FrameType.ResyncRequired) {
      this.cursor = this.store.oldestRetainedCursor();
      events = this.store.replayForSessions(this.cursor, this.sessions());
    }

    if (events === FrameType.ResyncRequired) {
      return;
    }

    for (const event of events) {
      if (!this.send(event)) {
        break;
      }
    }
  }
  acknowledge(cursor: Cursor) {
    this.store.acknowledge(cursor);
    const acknowledged = this.store.acknowledgedCursor();

    if (acknowledged.streamId === this.cursor.streamId && acknowledged.seq > this.cursor.seq) {
      this.cursor = acknowledged;
    }
  }
}
