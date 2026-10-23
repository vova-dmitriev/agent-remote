import { MAX_UNREAD_MESSAGES } from '@protocol';
import type { LocalStorePort } from '../domain/ports/local-store.js';

type ReadStore = Pick<LocalStorePort, 'readMarks' | 'setReadMark' | 'replies'>;

/**
 * The agent's replies each session got after the owner last read it. Read marks live in the store; the replies are
 * counted again from the stored events at start, then as they are published.
 */
export class UnreadMessages {
  private marks: Map<string, number>;
  private since: number;
  /** Unread reply ids by session, with when each was written. */
  private replies = new Map<string, Map<string, number>>();

  constructor(private store: ReadStore) {
    ({ marks: this.marks, since: this.since } = store.readMarks());

    for (const reply of store.replies(this.since)) {
      this.add(reply.sessionId, reply.id, reply.occurredAt);
    }
  }

  /** Counts a reply unless the owner read past it; returns whether the count changed. */
  add(sessionId: string, id: string, occurredAt: number): boolean {
    const replies = this.replies.get(sessionId) ?? new Map<string, number>();

    if (occurredAt <= (this.marks.get(sessionId) ?? this.since) || replies.has(id)) {
      return false;
    }

    if (replies.size >= MAX_UNREAD_MESSAGES) {
      // The count stops at its cap; the oldest reply makes room, so a later read mark still clears the right ones.
      replies.delete(replies.keys().next().value!);
      replies.set(id, occurredAt);
      this.replies.set(sessionId, replies);

      return false;
    }

    this.replies.set(sessionId, replies.set(id, occurredAt));

    return true;
  }

  /** Marks a session read up to a message time; returns whether its count changed. */
  read(sessionId: string, at: number): boolean {
    if (at <= (this.marks.get(sessionId) ?? 0)) {
      return false;
    }

    this.marks.set(sessionId, at);
    this.store.setReadMark(sessionId, at);
    const replies = this.replies.get(sessionId);
    const before = replies?.size ?? 0;

    for (const [id, occurredAt] of replies ?? []) {
      if (occurredAt <= at) {
        replies!.delete(id);
      }
    }

    return (replies?.size ?? 0) !== before;
  }

  count(sessionId: string): number {
    return this.replies.get(sessionId)?.size ?? 0;
  }
}
