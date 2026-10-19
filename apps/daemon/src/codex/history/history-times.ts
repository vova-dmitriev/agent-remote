import { CodexItemsView, CodexSortDirection, CodexMethod } from '../../domain/codex/codex.js';
import { object } from '../events.js';

export function messageTime(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function turnTime(raw: unknown): number {
  const turn = object(raw);

  return (
    messageTime(turn.turnStartedAtMs) ||
    messageTime(typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : 0)
  );
}

export function desktopItemTime(raw: unknown, item: unknown): number {
  const turn = object(raw),
    value = object(item);

  return (
    messageTime(object(turn.agentMessageCompletedAtMsById)[String(value.id)]) ||
    messageTime(object(turn.aeonAssistantMessageStartedAtMsById)[String(value.id)]) ||
    turnTime(turn)
  );
}

export async function historyTurnTimes(
  rpc: { request(method: string, params: unknown): Promise<unknown> },
  threadId: string,
  known: unknown[],
  required: Set<string>,
) {
  const times = new Map<string, number>();

  const remember = (raw: unknown) => {
    const turn = object(raw),
      time = turnTime(turn);

    if (typeof turn.id === 'string' && time) {
      times.set(turn.id, time);
    }
  };

  known.forEach(remember);
  let cursor: string | null = null;

  for (let pageIndex = 0; pageIndex < 5 && [...required].some((id) => !times.has(id)); pageIndex++) {
    let page: Record<string, unknown>;

    try {
      page = object(
        await rpc.request(CodexMethod.ThreadTurnsList, {
          threadId,
          limit: 100,
          sortDirection: CodexSortDirection.Desc,
          itemsView: CodexItemsView.NotLoaded,
          ...(cursor ? { cursor } : {}),
        }),
      );
    } catch {
      break;
    }

    (Array.isArray(page.data) ? page.data : []).forEach(remember);
    cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;

    if (!cursor) {
      break;
    }
  }

  return times;
}
