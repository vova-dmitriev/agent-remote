import { ClaudeRecordType, ClaudeContentType } from '../domain/claude.js';
import { openTranscript } from './transcript/transcript-file.js';

function messageTime(row: Record<string, unknown>, sessionId: string | undefined): number {
  if (
    (sessionId && row.sessionId !== sessionId) ||
    row.isMeta === true ||
    ![ClaudeRecordType.User, ClaudeRecordType.Assistant].some(
      (candidateValue) => candidateValue === String(row.type),
    )
  ) {
    return 0;
  }

  const content = (row.message as { content?: unknown } | undefined)?.content;

  const visible =
    typeof content === 'string'
      ? content.length > 0
      : Array.isArray(content) &&
        content.some(
          (block) =>
            block &&
            ((block.type === ClaudeContentType.Text &&
              typeof block.text === 'string' &&
              block.text.length > 0) ||
              [ClaudeContentType.Image, ClaudeContentType.File].some(
                (candidateValue) => candidateValue === block.type,
              )),
        );

  const time = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;

  return visible && Number.isFinite(time) && time > 0 ? time : 0;
}

/** Recency never waits for history normalization or attachment transfer. */
export class TranscriptActivity {
  private signature = '';
  private latest = 0;
  constructor(
    private path: string,
    private allowedRoot: string,
    private sessionId?: string,
  ) {}
  async read(): Promise<number> {
    const opened = await openTranscript(this.path, this.allowedRoot);

    if (!opened) {
      return this.latest;
    }

    const { file, info } = opened;

    try {
      const signature = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');

      if (signature === this.signature) {
        return this.latest;
      }

      let latest = 0;

      for (let budget = 1048576; budget <= 33554432; budget *= 2) {
        const start = Math.max(0, info.size - budget),
          buffer = Buffer.alloc(info.size - start);

        const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
        let offset = start ? buffer.indexOf(10) + 1 : 0;

        if (start && !offset) {
          continue;
        }

        while (offset < bytesRead) {
          const end = buffer.indexOf(10, offset);

          if (end < 0 || end >= bytesRead) {
            break;
          }

          try {
            const row: unknown = JSON.parse(buffer.toString('utf8', offset, end));

            if (row && typeof row === 'object' && !Array.isArray(row)) {
              latest = Math.max(latest, messageTime(row as Record<string, unknown>, this.sessionId));
            }
          } catch {} // ignore: incomplete and malformed JSONL never provides a timestamp.

          offset = end + 1;
        }

        if (latest || !start) {
          break;
        }
      }

      this.signature = signature;
      this.latest = Math.max(this.latest, latest);

      return this.latest;
    } finally {
      await file.close();
    }
  }
}
