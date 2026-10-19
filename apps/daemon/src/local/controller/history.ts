import { randomUUID } from 'node:crypto';
import {
  CodedError,
  ErrorCode,
  EventType,
  FrameType,
  HistoryCursorPrefix,
  type LocalAction,
  LocalOperation,
} from '@protocol';
import { TRANSCRIPT_POSITION_PREFIX } from '../../code/transcript/transcript-limits.js';
import { bytePage } from '../history/index.js';
import type { LocalControllerOptions } from './types.js';

function nativeCursor(position: string | undefined) {
  if (!position?.startsWith(TRANSCRIPT_POSITION_PREFIX)) {
    throw new CodedError(ErrorCode.INVALID_CURSOR);
  }

  return position.slice(TRANSCRIPT_POSITION_PREFIX.length);
}

export async function localHistory(
  options: LocalControllerOptions,
  action: Extract<LocalAction, { operation: typeof LocalOperation.History }>,
) {
  const page = action.anchor?.startsWith(HistoryCursorPrefix.Cache)
    ? null
    : await options.history?.({
        type: FrameType.HistoryRead,
        requestId: randomUUID(),
        sessionId: action.sessionId,
        generation: action.generation,
        direction: action.direction,
        ...(action.anchor
          ? {
              anchor:
                action.position ??
                (action.anchor.startsWith(HistoryCursorPrefix.Source)
                  ? action.anchor.slice(HistoryCursorPrefix.Source.length)
                  : action.anchor),
            }
          : {}),
      });

  if (!page) {
    return options.store.historyPage(action);
  }

  const cursor = options.store.cursor();

  const events = page.messages.map((message) => ({
    version: 1 as const,
    deviceId: options.deviceId,
    eventId: randomUUID(),
    sessionId: action.sessionId,
    streamId: cursor.streamId,
    seq: 0,
    type: EventType.Message,
    occurredAt: message.occurredAt,
    payload: message,
  }));

  const anchor = page.messages.findIndex(
    (message) => message.id === action.anchor || message.historyCursor === (action.position ?? action.anchor),
  );

  const { start, end } = bytePage(events, action.direction, anchor);

  return {
    events: events.slice(start, end),
    before: start > 0 ? nativeCursor(page.messages[start]?.historyCursor) : page.before,
    after: end < events.length ? nativeCursor(page.messages[end]?.historyCursor) : page.after,
  };
}
