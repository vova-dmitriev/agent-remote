import { ClaudeRecordType, ClaudeContentType } from '../../domain/claude.js';
import {
  TRANSCRIPT_DEFAULT_MAX_READ_BYTES,
  TRANSCRIPT_DEFAULT_MAX_LINE_BYTES,
  TRANSCRIPT_MEDIA_MAX_LINE_BYTES,
  TRANSCRIPT_MAX_TEXT_BYTES,
  TRANSCRIPT_MAX_SEEN_IDS,
  TRANSCRIPT_READ_CHUNK_BYTES,
  TRANSCRIPT_PREFIX_BYTES,
  TRANSCRIPT_ANCHOR_BYTES,
  TRANSCRIPT_POSITION_PREFIX,
  JSONL_NEWLINE_BYTE,
} from '../../domain/transcript/limits.js';
import { nativeClaudeMedia } from '../../attachments/content/native.js';
import { type NativeMedia } from '../../attachments/types.js';
import { openTranscript, type TranscriptOpenOptions } from './transcript-file.js';
import { createHash } from 'node:crypto';
import { positiveInteger, truncateUtf8, type HistoryMessage } from '@protocol';
import { TranscriptTitle } from './transcript-title.js';
import { FileChangeLog } from '../../activity/file-changes.js';
import { claudeFileEdit, readEditsTail } from '../../activity/claude-changes.js';
import { transcriptWindow } from './transcript-window.js';
import { transcriptToolItems } from './transcript-tools.js';
import { logDebug } from '../../diagnostics/log.js';

interface Candidate {
  message: HistoryMessage;
  media: NativeMedia[];
}
interface ReaderOptions {
  path: string;
  allowedRoot: string;
  sessionId?: string;
  /** Tool calls and results become history items (subagent transcripts); the parent feed keeps text only. */
  includeTools?: boolean;
  open?: TranscriptOpenOptions;
  withPosition?: boolean;
  onPosition?: (id: string, offset: number) => void;
  initialWindow?: number;
  /** A live session's reader: also lists the files edited before it attached (a history page does not). */
  editsTail?: boolean;
  startAt?: number;
  endAt?: number;
  maxLineBytes?: number;
  maxTextBytes?: number;
  maxReadBytes?: number;
  maxSeenIds?: number;
  transform?: (message: HistoryMessage, media: NativeMedia[]) => Promise<HistoryMessage>;
}

/** Incremental reader for an exact hook-provided path; never searches other sessions. */
export class TranscriptReader {
  private offset = 0;
  private identity = '';
  private anchor = Buffer.alloc(0);
  private prefix = Buffer.alloc(0);
  private observedSize = 0;
  private observedMetadata = '';
  private partial = Buffer.alloc(0);
  private droppingLine = false;
  private readonly seen = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly maxLineBytes: number;
  private readonly maxTextBytes: number;
  private readonly maxReadBytes: number;
  private readonly maxSeenIds: number;
  private readonly titles: TranscriptTitle;
  private readonly edits = new FileChangeLog();

  constructor(private readonly options: ReaderOptions) {
    this.titles = new TranscriptTitle(options.sessionId);

    this.maxLineBytes = positiveInteger(
      options.maxLineBytes ??
        (options.transform ? TRANSCRIPT_MEDIA_MAX_LINE_BYTES : TRANSCRIPT_DEFAULT_MAX_LINE_BYTES),
      'MAX_LINE_BYTES',
    );

    this.maxTextBytes = positiveInteger(options.maxTextBytes ?? TRANSCRIPT_MAX_TEXT_BYTES, 'MAX_TEXT_BYTES');

    this.maxReadBytes = positiveInteger(
      options.maxReadBytes ?? TRANSCRIPT_DEFAULT_MAX_READ_BYTES,
      'MAX_READ_BYTES',
    );

    this.maxSeenIds = positiveInteger(options.maxSeenIds ?? TRANSCRIPT_MAX_SEEN_IDS, 'MAX_SEEN_IDS');
  }

  /** The files this session's Edit and Write calls changed; undefined while there are none. */
  get changes() {
    return this.edits.size ? this.edits.value() : undefined;
  }

  get title(): string | undefined {
    return this.titles.title;
  }

  get model(): string | undefined {
    return this.titles.model;
  }

  readNext(): Promise<HistoryMessage[]> {
    const result = this.queue.then(() => this.read());

    this.queue = result.catch((error: unknown) => logDebug('code/transcript/transcript-reader', error));

    return result;
  }

  private async read(): Promise<HistoryMessage[]> {
    const opened = await openTranscript(this.options.path, this.options.allowedRoot, this.options.open);

    if (!opened) {
      return [];
    }

    const { file, info } = opened;

    try {
      const identity = `${info.dev}:${info.ino}`;
      const metadata = `${info.mtimeMs}:${info.ctimeMs}`;

      let reset =
        identity !== this.identity ||
        info.size < this.offset ||
        (info.size <= this.observedSize && metadata !== this.observedMetadata);

      if (!reset && this.prefix.length) {
        const check = Buffer.alloc(this.prefix.length);
        const { bytesRead } = await file.read(check, 0, check.length, 0);

        reset = bytesRead !== check.length || !check.equals(this.prefix);
      }

      if (!reset && this.anchor.length) {
        const check = Buffer.alloc(this.anchor.length);
        const { bytesRead } = await file.read(check, 0, check.length, this.offset - check.length);

        reset = bytesRead !== check.length || !check.equals(this.anchor);
      }

      if (reset) {
        this.titles.reset();
        this.edits.reset();

        if (this.options.editsTail) {
          await readEditsTail(file, info.size, this.options.sessionId, this.edits);
        }

        let initialOffset = this.options.startAt;

        if (initialOffset === undefined) {
          initialOffset = 0;

          if (this.options.initialWindow === 0) {
            initialOffset = info.size;
          } else if (this.options.initialWindow) {
            initialOffset = await transcriptWindow(
              file,
              info.size,
              this.options.initialWindow,
              this.options.sessionId,
              this.options.includeTools,
            );
          }
        }

        this.offset = initialOffset;

        this.partial = Buffer.alloc(0);
        this.droppingLine = false;
        this.anchor = Buffer.alloc(0);
        this.prefix = Buffer.alloc(0);
        this.identity = identity;
      }

      if (reset || metadata !== this.observedMetadata || info.size !== this.observedSize) {
        await this.titles.readTail(file, info.size);
      }

      const messages: Candidate[] = [];

      const end = Math.min(
        info.size,
        this.options.endAt ?? Infinity,
        reset && this.options.initialWindow ? info.size : this.offset + this.maxReadBytes,
      );

      while (this.offset < end) {
        const buffer = Buffer.alloc(Math.min(TRANSCRIPT_READ_CHUNK_BYTES, end - this.offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, this.offset);

        if (!bytesRead) {
          break;
        }

        this.offset += bytesRead;
        const chunk = buffer.subarray(0, bytesRead);

        if (this.offset - bytesRead === this.prefix.length && this.prefix.length < TRANSCRIPT_PREFIX_BYTES) {
          this.prefix = Buffer.concat([
            this.prefix,
            chunk.subarray(0, TRANSCRIPT_PREFIX_BYTES - this.prefix.length),
          ]);
        }

        this.consume(chunk, messages);
        this.anchor = Buffer.from(Buffer.concat([this.anchor, chunk]).subarray(-TRANSCRIPT_ANCHOR_BYTES));
      }

      this.observedSize = info.size;
      this.observedMetadata = metadata;
      const output: HistoryMessage[] = [];

      for (const { message, media } of messages) {
        const normalized = this.options.transform
          ? await this.options.transform(message, media).catch(() => message)
          : message;

        if (normalized.text || normalized.attachments?.length || normalized.tool) {
          output.push(normalized);
        }
      }

      return output;
    } finally {
      await file.close();
    }
  }

  private consume(chunk: Buffer, messages: Candidate[]): void {
    let start = 0;

    while (start < chunk.length) {
      const newline = chunk.indexOf(JSONL_NEWLINE_BYTE, start);
      const end = newline === -1 ? chunk.length : newline;
      const segment = chunk.subarray(start, end);

      if (!this.droppingLine) {
        if (this.partial.length + segment.length > this.maxLineBytes) {
          this.partial = Buffer.alloc(0);
          this.droppingLine = true;
        } else {
          this.partial = Buffer.concat([this.partial, segment]);
        }
      }

      if (newline === -1) {
        break;
      }

      if (!this.droppingLine) {
        messages.push(...this.parse(this.partial, this.offset - chunk.length + newline));
      }

      this.partial = Buffer.alloc(0);
      this.droppingLine = false;
      start = newline + 1;
    }
  }

  private parse(line: Buffer, position: number): Candidate[] {
    let row: Record<string, unknown>;

    try {
      row = JSON.parse(line.toString('utf8')) as Record<string, unknown>;
    } catch {
      return [];
    }

    if (row && typeof row === 'object') {
      this.titles.observe(row, position, line);

      const edit = claudeFileEdit(row, this.options.sessionId);

      if (edit) {
        this.edits.add(edit);
      }
    }

    if (this.options.sessionId && row.sessionId !== undefined && row.sessionId !== this.options.sessionId) {
      return [];
    }

    if (
      !row ||
      ![
        ClaudeRecordType.User,
        ClaudeRecordType.Assistant,
        ...(this.options.transform ? ['attachment'] : []),
      ].some((candidateValue) => candidateValue === String(row.type)) ||
      row.isMeta === true
    ) {
      return [];
    }

    const message = row.message as { content?: unknown } | undefined;
    const content = message?.content;

    let text = typeof content === 'string' ? content : '';

    if (Array.isArray(content)) {
      text = content
        .filter(
          (block): block is { type: typeof ClaudeContentType.Text; text: string } =>
            block?.type === ClaudeContentType.Text && typeof block.text === 'string',
        )
        .map((block) => block.text)
        .join('\n');
    }

    const media = this.options.transform ? nativeClaudeMedia(row) : [];
    const tools = this.options.includeTools ? transcriptToolItems(content) : [];

    if (!text && !media.length && !tools.length) {
      return [];
    }

    const id =
      typeof row.uuid === 'string' && row.uuid.length > 0
        ? row.uuid
        : createHash('sha256').update(line).digest('hex');

    if (this.seen.has(id)) {
      return [];
    }

    this.seen.add(id);

    if (this.seen.size > this.maxSeenIds) {
      this.seen.delete(this.seen.values().next().value!);
    }

    const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;

    const base = {
      role: row.type === ClaudeRecordType.Assistant ? ClaudeRecordType.Assistant : ClaudeRecordType.User,
      occurredAt: Number.isFinite(timestamp) ? timestamp : 0,
      ...(this.options.withPosition
        ? {
            historyCursor:
              TRANSCRIPT_POSITION_PREFIX +
              Buffer.from(
                JSON.stringify({
                  dev: Number(this.identity.split(':')[0]),
                  ino: Number(this.identity.split(':')[1]),
                  offset: position - line.length,
                }),
              ).toString('base64url'),
          }
        : {}),
    };

    const candidates: Candidate[] = [
      ...(text || media.length
        ? [{ media, message: { id, ...base, text: truncateUtf8(text, this.maxTextBytes) } }]
        : []),
      ...tools.map((item) => ({
        media: [],
        message: { id: `${id}/${item.index}`, ...base, text: item.text, tool: item.tool },
      })),
    ];

    for (const candidate of candidates) {
      this.options.onPosition?.(candidate.message.id, position - line.length);
    }

    return candidates;
  }
}
