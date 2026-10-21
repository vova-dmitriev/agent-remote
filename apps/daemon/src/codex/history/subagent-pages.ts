import { CodedError, ErrorCode, HistoryDirection, type HistoryMessage, type HistoryRead } from '@protocol';
import { CodexItemType, CodexMethod, CodexSortDirection } from '../../domain/codex/codex.js';
import type { CodexClient } from '../../domain/codex/client.js';
import { itemMessage, object } from '../events.js';
import type { CodexSubagents } from '../binding/subagents.js';

const CODEX_SUBAGENT_PAGE_SIZE = 100;
const CODEX_SUBAGENT_CURSOR_MAX_BYTES = 1024;

type Cursor = { threadId: string; cursor: string };
type Page = { messages: HistoryMessage[]; before: string | null; after: string | null };

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(value: string | undefined, threadId: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const cursor = object(parsed);

    if (
      Object.keys(cursor).length !== 2 ||
      cursor.threadId !== threadId ||
      typeof cursor.cursor !== 'string' ||
      !cursor.cursor ||
      cursor.cursor.length > CODEX_SUBAGENT_CURSOR_MAX_BYTES
    ) {
      throw new CodedError(ErrorCode.INVALID_CURSOR);
    }

    return cursor.cursor;
  } catch {
    throw new CodedError(ErrorCode.INVALID_CURSOR);
  }
}

/** Reads only a currently listed child through its owning Codex RPC; the client never chooses a thread id. */
export class CodexSubagentPages {
  constructor(
    private readonly parentId: string,
    private readonly generation: string,
    private readonly rpc: CodexClient,
    private readonly subagents: CodexSubagents,
    private readonly current: () => boolean,
    private readonly readItems: (threadId: string, params: unknown) => Promise<unknown> = (
      threadId,
      params,
    ) => rpc.request(CodexMethod.ThreadItemsList, { ...object(params), threadId }),
  ) {}

  async page(request: HistoryRead): Promise<Page> {
    const threadId = request.agentId;

    if (
      !threadId ||
      request.sessionId !== this.parentId ||
      request.generation !== this.generation ||
      !this.current()
    ) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    if (!this.subagents.has(threadId)) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    if (request.direction !== HistoryDirection.Latest && request.direction !== HistoryDirection.Before) {
      throw new CodedError(ErrorCode.INVALID_CURSOR);
    }

    const cursor = decodeCursor(
      request.direction === HistoryDirection.Before ? request.anchor : undefined,
      threadId,
    );

    const result = object(
      await this.readItems(threadId, {
        limit: CODEX_SUBAGENT_PAGE_SIZE,
        sortDirection: CodexSortDirection.Desc,
        ...(cursor ? { cursor } : {}),
      }),
    );

    // The binding may be replaced, closed, or lose this child while the RPC is pending.
    if (!this.current() || !this.subagents.has(threadId)) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    const entries = Array.isArray(result.data) ? result.data : [];

    if (entries.length > CODEX_SUBAGENT_PAGE_SIZE) {
      throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    const messages = entries
      .map((entry) => {
        const row = object(entry);
        const item = object(row.item);

        if (item.type !== CodexItemType.UserMessage && item.type !== CodexItemType.AgentMessage) {
          return undefined;
        }

        return itemMessage(
          item,
          typeof row.turnId === 'string' ? row.turnId : threadId,
          typeof row.occurredAt === 'number' ? row.occurredAt : Date.now(),
        );
      })
      .filter((message): message is HistoryMessage => message !== undefined)
      .reverse();

    const nextCursor =
      typeof result.nextCursor === 'string' && result.nextCursor.length <= CODEX_SUBAGENT_CURSOR_MAX_BYTES
        ? result.nextCursor
        : undefined;

    return {
      messages,
      before: nextCursor ? encodeCursor({ threadId, cursor: nextCursor }) : null,
      after: null,
    };
  }
}
