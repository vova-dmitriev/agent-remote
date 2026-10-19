import { randomUUID } from 'node:crypto';
import {
  EventType,
  FrameType,
  HistoryDirection,
  HistoryCursorPrefix,
  TargetKind,
  historySchema,
  type Cursor,
  type HistoryRead,
} from '@protocol';
import type { CheckpointSource } from '../context/types.js';
import { sourceBase, mapMessage } from './base.js';
import { sameFence } from '../context/values.js';
import type { NativeCheckpointSourceOptions } from './types.js';
import { CheckpointSourceError, NativeCheckpointSourceLimits, sourceFailure } from './values.js';
import { TRANSCRIPT_POSITION_PREFIX } from '../../code/transcript/transcript-limits.js';
import { openTranscript } from '../../code/transcript/transcript-file.js';
import type { TranscriptSources } from '../../monitor/history.js';
import type { LocalStore } from '../../monitor/store.js';

interface ClaudeOptions extends NativeCheckpointSourceOptions {
  readers: TranscriptSources;
  transcriptPath: string;
  allowedRoot: string;
}

interface CodexOptions extends NativeCheckpointSourceOptions {
  store: LocalStore;
}

function pageAnchor(messages: readonly { historyCursor?: string }[], start: number): string | null {
  const cursor = messages[start]?.historyCursor;

  return cursor?.startsWith(TRANSCRIPT_POSITION_PREFIX)
    ? cursor.slice(TRANSCRIPT_POSITION_PREFIX.length)
    : null;
}

export function createClaudeCheckpointSource(options: ClaudeOptions): CheckpointSource {
  const { source, attachments, validate } = sourceBase(options, [TargetKind.ClaudeCodeCli], async () => {
    const opened = await openTranscript(options.transcriptPath, options.allowedRoot);

    if (!opened) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    try {
      const info = opened.info;

      return `file:${Buffer.from(JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs])).toString('base64url')}`;
    } finally {
      await opened.file.close();
    }
  });

  source.page = async (request) => {
    const session = validate();
    const before = await source.captureFence();

    if (before.historyWatermark !== request.watermark) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    const anchor = request.anchor;

    const page = await options.readers.page({
      type: FrameType.HistoryRead,
      requestId: randomUUID(),
      sessionId: session.id,
      generation: options.generation,
      direction: anchor ? HistoryDirection.Before : HistoryDirection.Latest,
      ...(anchor ? { anchor } : {}),
    } satisfies HistoryRead);

    const messages = page.messages.slice(-Math.min(request.limit, NativeCheckpointSourceLimits.PageSize));
    const current = await source.captureFence();

    if (!sameFence(before, current)) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    const start = page.messages.length - messages.length;

    return {
      messages: messages.flatMap((message) => {
        const mapped = mapMessage(message, attachments);

        return mapped ? [mapped] : [];
      }),
      nextAnchor: start > 0 ? pageAnchor(page.messages, start) : page.before,
      hasMore: start > 0 || page.before !== null,
    };
  };

  return source;
}

export function createCodexCheckpointSource(options: CodexOptions): CheckpointSource {
  const { source, attachments, validate } = sourceBase(
    options,
    [TargetKind.CodexCli, TargetKind.CodexDesktop],
    async () => {
      const cursor: Cursor = options.store.cursor();
      const oldest = options.store.oldestRetainedCursor();

      return `codex:${cursor.streamId}:${cursor.seq}:${oldest.seq}`;
    },
  );

  source.page = async (request) => {
    const session = validate();
    const before = await source.captureFence();

    if (before.historyWatermark !== request.watermark) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    const page = options.store.historyPage({
      sessionId: session.id,
      direction: request.anchor ? HistoryDirection.Before : HistoryDirection.Latest,
      ...(request.anchor ? { anchor: request.anchor } : {}),
    });

    if (!page || !Array.isArray(page.events)) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    if (!sameFence(before, await source.captureFence())) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    const limit = Math.min(request.limit, NativeCheckpointSourceLimits.PageSize);
    const start = Math.max(0, page.events.length - limit);
    const events = page.events.slice(start);

    const messages = events.flatMap((event) => {
      const parsed = event.type === EventType.Message ? historySchema.safeParse(event.payload) : null;

      return parsed?.success ? [parsed.data] : [];
    });

    return {
      messages: messages.flatMap((message) => {
        const mapped = mapMessage(message, attachments);

        return mapped ? [mapped] : [];
      }),
      nextAnchor:
        start > 0 && events[0]
          ? HistoryCursorPrefix.Cache +
            Buffer.from(JSON.stringify({ at: events[0].occurredAt, seq: events[0].seq })).toString(
              'base64url',
            )
          : page.before,
      hasMore: start > 0 || page.before !== null,
    };
  };

  return source;
}
