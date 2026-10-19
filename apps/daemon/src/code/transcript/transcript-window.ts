import { DaemonErrorCode } from '../../error-codes.js';
import { ClaudeRecordType, ClaudeContentType } from '../../domain/claude.js';
import {
  TRANSCRIPT_WINDOW_BYTES,
  TRANSCRIPT_BACKWARD_CHUNK_BYTES,
  JSONL_NEWLINE_BYTE,
} from './transcript-limits.js';
import { type FileHandle } from 'node:fs/promises';

export function visibleTranscriptRow(row: Record<string, unknown>, sessionId?: string): boolean {
  if ((sessionId && row.sessionId !== undefined && row.sessionId !== sessionId) || row.isMeta === true) {
    return false;
  }

  if (row.type === ClaudeRecordType.Attachment) {
    const attachment = row.attachment as
      { type?: string; content?: { type?: string; file?: { base64?: string } } } | undefined;

    return (
      attachment?.type === ClaudeContentType.File &&
      [ClaudeContentType.Image, ClaudeContentType.Pdf].some(
        (candidateValue) => candidateValue === (attachment.content?.type ?? ''),
      ) &&
      !!attachment.content?.file?.base64
    );
  }

  if (
    ![ClaudeRecordType.User, ClaudeRecordType.Assistant].some(
      (candidateValue) => candidateValue === String(row.type),
    )
  ) {
    return false;
  }

  const content = (row.message as { content?: unknown } | undefined)?.content;

  return typeof content === 'string'
    ? !!content
    : Array.isArray(content) &&
        content.some(
          (block) =>
            block &&
            ((block.type === ClaudeContentType.Text && !!block.text) ||
              [ClaudeContentType.Image, ClaudeContentType.File].some(
                (candidateValue) => candidateValue === block.type,
              )),
        );
}

/** Locate one bounded page from the end. No history replay or attachment normalization. */
export async function transcriptWindow(file: FileHandle, end: number, count: number, sessionId?: string) {
  const floor = Math.max(0, end - TRANSCRIPT_WINDOW_BYTES);
  let start = end;
  let pending = Buffer.alloc(0);
  let found = 0;
  const seen = new Set<string>();

  while (start > floor) {
    const next = Math.max(floor, start - TRANSCRIPT_BACKWARD_CHUNK_BYTES);
    const buffer = Buffer.alloc(start - next);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, next);

    if (bytesRead !== buffer.length) {
      throw new Error(DaemonErrorCode.TRANSCRIPT_CHANGED);
    }

    const combined = Buffer.concat([buffer, pending]);
    let lineEnd = combined.length - 1;

    // The final incomplete JSONL record belongs to the live reader, not this page.
    if (start === end && combined[lineEnd] !== JSONL_NEWLINE_BYTE) {
      lineEnd = combined.lastIndexOf(JSONL_NEWLINE_BYTE);
    }

    while (lineEnd >= 0) {
      const previous = lineEnd > 0 ? combined.lastIndexOf(JSONL_NEWLINE_BYTE, lineEnd - 1) : -1;

      if (previous < 0 && next !== 0) {
        break;
      }

      const lineStart = previous + 1;

      try {
        const row = JSON.parse(combined.toString('utf8', lineStart, lineEnd));

        if (row && typeof row === 'object' && visibleTranscriptRow(row, sessionId)) {
          const id = typeof row.uuid === 'string' ? row.uuid : String(next + lineStart);

          if (!seen.has(id)) {
            seen.add(id);

            if (++found >= count) {
              return next + lineStart;
            }
          }
        }
      } catch {
        /* Malformed and oversized tool records do not become messages. */
      }

      lineEnd = previous;
    }

    pending = combined.subarray(0, Math.max(0, lineEnd + 1));
    start = next;
  }

  // Skip a cut record at the bounded scan limit.
  return start ? start + Math.max(0, pending.indexOf(JSONL_NEWLINE_BYTE) + 1) : 0;
}
