import { DaemonErrorCode } from '../../error-codes.js';
import {
  CodedError,
  ErrorCode,
  hasErrorCode,
  HistoryDirection,
  type HistoryMessage,
  type HistoryRead,
} from '@protocol';

import {
  TRANSCRIPT_PAGE_MESSAGES,
  TRANSCRIPT_AROUND_BEFORE_MESSAGES,
  TRANSCRIPT_AROUND_AFTER_MESSAGES,
  TRANSCRIPT_WINDOW_BYTES,
  TRANSCRIPT_READ_CHUNK_BYTES,
  TRANSCRIPT_MAX_POSITION_ENTRIES,
  TRANSCRIPT_POSITION_PREFIX,
  JSONL_NEWLINE_BYTE,
} from '../../domain/transcript/limits.js';
import { z } from 'zod';
import { openTranscript, type TranscriptOpenOptions } from './transcript-file.js';
import { transcriptRowItems, transcriptWindow } from './transcript-window.js';
import { TranscriptReader } from './transcript-reader.js';
import { logDebugCount } from '../../diagnostics/log.js';

const TRANSCRIPT_PAGES_SCOPE = 'code/transcript/transcript-pages';
/** Partial or malformed JSONL rows, which never become messages. */
const MALFORMED_ROWS = 'malformed_rows';

const cursorSchema = z.strictObject({
  dev: z.number(),
  ino: z.number(),
  offset: z.number().int().nonnegative().safe(),
});

interface Options {
  path: string;
  allowedRoot: string;
  sessionId?: string;
  /** Tool calls and results become history items (subagent transcripts). */
  includeTools?: boolean;
  open?: TranscriptOpenOptions;
  transform?: (
    message: HistoryMessage,
    media: import('../../attachments/types.js').NativeMedia[],
  ) => Promise<HistoryMessage>;
}
export class TranscriptPages {
  private positions = new Map<string, number>();
  constructor(private options: Options) {}
  async page(request: Pick<HistoryRead, 'direction' | 'anchor'>) {
    const opened = await openTranscript(this.options.path, this.options.allowedRoot, this.options.open);

    if (!opened) {
      throw new CodedError(ErrorCode.TRANSCRIPT_UNAVAILABLE);
    }

    const { file, info } = opened;

    const encode = (offset: number) =>
      Buffer.from(JSON.stringify({ dev: info.dev, ino: info.ino, offset })).toString('base64url');

    let start = 0,
      end = info.size;

    try {
      if (request.direction === HistoryDirection.Before || request.direction === HistoryDirection.After) {
        let cursor: z.infer<typeof cursorSchema>;

        try {
          cursor = cursorSchema.parse(JSON.parse(Buffer.from(request.anchor ?? '', 'base64url').toString()));
        } catch {
          throw new CodedError(ErrorCode.INVALID_CURSOR);
        }

        if (cursor.dev !== info.dev || cursor.ino !== info.ino || cursor.offset > info.size) {
          throw new CodedError(DaemonErrorCode.TRANSCRIPT_CHANGED);
        }

        if (request.direction === HistoryDirection.Before) {
          end = cursor.offset;
        } else {
          start = cursor.offset;
        }
      }

      if (
        (request.direction === HistoryDirection.Around || request.direction === HistoryDirection.Message) &&
        request.anchor
      ) {
        let position: number | undefined;

        if (request.anchor.startsWith(TRANSCRIPT_POSITION_PREFIX)) {
          try {
            position = this.position(request.anchor.slice(TRANSCRIPT_POSITION_PREFIX.length), info);
          } catch (error) {
            if (!hasErrorCode(error, DaemonErrorCode.TRANSCRIPT_CHANGED)) {
              throw error;
            }
          }
        } else {
          position =
            this.positions.get(request.anchor) ?? (await this.locate(file, info.size, request.anchor));
        }

        if (position !== undefined) {
          const following = await this.forward(
            file,
            position,
            info.size,
            request.direction === HistoryDirection.Message ? 1 : TRANSCRIPT_AROUND_AFTER_MESSAGES,
          );

          end = following;

          start =
            request.direction === HistoryDirection.Message
              ? position
              : await transcriptWindow(
                  file,
                  position,
                  TRANSCRIPT_AROUND_BEFORE_MESSAGES,
                  this.options.sessionId,
                  this.options.includeTools,
                );
        } else {
          if (request.direction === HistoryDirection.Message) {
            throw new CodedError(DaemonErrorCode.TRANSCRIPT_CHANGED);
          }

          start = await transcriptWindow(
            file,
            end,
            TRANSCRIPT_PAGE_MESSAGES,
            this.options.sessionId,
            this.options.includeTools,
          );
        }
      } else if (request.direction === HistoryDirection.After) {
        end = await this.forward(file, start, info.size, TRANSCRIPT_PAGE_MESSAGES);
      } else {
        start = await transcriptWindow(
          file,
          end,
          TRANSCRIPT_PAGE_MESSAGES,
          this.options.sessionId,
          this.options.includeTools,
        );
      }
    } finally {
      await file.close();
    }

    const offsets = new Map<string, number>();

    const reader = new TranscriptReader({
      ...this.options,
      ...(this.options.transform
        ? {
            transform: (message, media) =>
              this.options.transform!(
                {
                  ...message,
                  historyCursor: TRANSCRIPT_POSITION_PREFIX + encode(offsets.get(message.id) ?? start),
                },
                media,
              ),
          }
        : {}),
      startAt: start,
      endAt: end,
      maxReadBytes: TRANSCRIPT_WINDOW_BYTES,
      onPosition: (id, offset) => {
        offsets.set(id, offset);
        this.positions.set(id, offset);

        if (this.positions.size > TRANSCRIPT_MAX_POSITION_ENTRIES) {
          this.positions.delete(this.positions.keys().next().value!);
        }
      },
    });

    const messages = await reader.readNext();

    // Known limit: one record with more items than a page (over 100 tool blocks) keeps only its last ones.
    return {
      messages: messages.slice(-TRANSCRIPT_PAGE_MESSAGES).map((message) => ({
        ...message,
        historyCursor: TRANSCRIPT_POSITION_PREFIX + encode(offsets.get(message.id) ?? start),
      })),
      before: start ? encode(start) : null,
      after: end < info.size ? encode(end) : null,
    };
  }
  private position(value: string, info: { dev: number; ino: number; size: number }) {
    let cursor: z.infer<typeof cursorSchema>;

    try {
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    } catch {
      throw new CodedError(ErrorCode.INVALID_CURSOR);
    }

    if (cursor.dev !== info.dev || cursor.ino !== info.ino || cursor.offset > info.size) {
      throw new CodedError(DaemonErrorCode.TRANSCRIPT_CHANGED);
    }

    return cursor.offset;
  }
  private async locate(
    file: import('node:fs/promises').FileHandle,
    size: number,
    id: string,
  ): Promise<number | undefined> {
    let malformed = 0;

    try {
      return await this.search(file, size, id, () => malformed++);
    } finally {
      logDebugCount(TRANSCRIPT_PAGES_SCOPE, MALFORMED_ROWS, malformed);
    }
  }
  private async search(
    file: import('node:fs/promises').FileHandle,
    size: number,
    id: string,
    skip: () => void,
  ): Promise<number | undefined> {
    let end = size;
    // Only this explicit saved-message request searches backwards. Opening a chat never scans from the beginning.
    const floor = Math.max(0, size - TRANSCRIPT_WINDOW_BYTES);

    while (end > floor) {
      const start = await transcriptWindow(
        file,
        end,
        TRANSCRIPT_PAGE_MESSAGES,
        this.options.sessionId,
        this.options.includeTools,
      );

      const buffer = Buffer.alloc(end - start);

      await file.read(buffer, 0, buffer.length, start);
      let offset = 0;

      while (offset < buffer.length) {
        const next = buffer.indexOf(JSONL_NEWLINE_BYTE, offset);

        if (next < 0) {
          break;
        }

        try {
          const row = JSON.parse(buffer.toString('utf8', offset, next));

          if (row.uuid === id) {
            this.positions.set(id, start + offset);

            return start + offset;
          }
        } catch {
          skip();
        }

        offset = next + 1;
      }

      if (start >= end) {
        break;
      }

      end = start;
    }
  }
  private async forward(
    file: import('node:fs/promises').FileHandle,
    start: number,
    size: number,
    count: number,
  ) {
    let malformed = 0;

    try {
      return await this.scanForward(file, start, size, count, () => malformed++);
    } finally {
      logDebugCount(TRANSCRIPT_PAGES_SCOPE, MALFORMED_ROWS, malformed);
    }
  }
  private async scanForward(
    file: import('node:fs/promises').FileHandle,
    start: number,
    size: number,
    count: number,
    skip: () => void,
  ) {
    const limit = Math.min(size, start + TRANSCRIPT_WINDOW_BYTES);

    let offset = start,
      partial = Buffer.alloc(0),
      found = 0;

    while (offset < limit) {
      const buffer = Buffer.alloc(Math.min(TRANSCRIPT_READ_CHUNK_BYTES, limit - offset));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);

      if (!bytesRead) {
        break;
      }

      const combined = Buffer.concat([partial, buffer.subarray(0, bytesRead)]),
        base = offset - partial.length;

      let at = 0;

      for (
        let next = combined.indexOf(JSONL_NEWLINE_BYTE);
        next >= 0;
        next = combined.indexOf(JSONL_NEWLINE_BYTE, at)
      ) {
        try {
          const row = JSON.parse(combined.toString('utf8', at, next));
          const items = transcriptRowItems(row, this.options.sessionId, this.options.includeTools);

          // A record whose items would overflow a non-empty page starts the next page instead.
          if (items && found && found + items > count) {
            return base + at;
          }

          found += items;

          if (items && found >= count) {
            return base + next + 1;
          }
        } catch {
          skip();
        }

        at = next + 1;
      }

      partial = combined.subarray(at);
      offset += bytesRead;
    }

    return offset - partial.length;
  }
}
