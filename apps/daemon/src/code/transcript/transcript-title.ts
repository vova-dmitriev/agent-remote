import { ClaudeRecordType } from '../../domain/claude.js';
import { ASCII_CONTROL_CHARACTERS } from '../../validation/control-characters.js';
import { type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { truncateUtf8 } from '@protocol';

const tailBytes = 262_144;

interface TitleEntry {
  text: string;
  position: number;
  start: number;
  bytes: number;
  fingerprint: string;
}
const fingerprint = (line: Buffer) => createHash('sha256').update(line).digest('hex');

/** Display metadata comes only from Claude's records for this exact session. */
export class TranscriptTitle {
  private custom: TitleEntry | undefined;
  private generated: TitleEntry | undefined;
  private assistantModel: TitleEntry | undefined;

  constructor(private readonly sessionId: string | undefined) {}

  get title(): string | undefined {
    return this.custom?.text ?? this.generated?.text;
  }

  get model(): string | undefined {
    return this.assistantModel?.text;
  }

  reset(): void {
    this.custom = undefined;
    this.generated = undefined;
    this.assistantModel = undefined;
  }

  observe(row: Record<string, unknown>, position: number, line: Buffer): void {
    const entry = this.entry(row, position, line);

    if (!entry) {
      return;
    }

    if (row.type === ClaudeRecordType.Assistant && position > (this.assistantModel?.position ?? -1)) {
      this.assistantModel = entry;
    }

    if (row.type === ClaudeRecordType.CustomTitle && position > (this.custom?.position ?? -1)) {
      this.custom = entry;
    }

    if (row.type === ClaudeRecordType.AiTitle && position > (this.generated?.position ?? -1)) {
      this.generated = entry;
    }
  }

  private entry(row: Record<string, unknown>, position: number, line: Buffer): TitleEntry | undefined {
    if (!this.sessionId || row.sessionId !== this.sessionId) {
      return;
    }

    if (
      ![ClaudeRecordType.CustomTitle, ClaudeRecordType.AiTitle, ClaudeRecordType.Assistant].some(
        (candidateValue) => candidateValue === String(row.type),
      )
    ) {
      return;
    }

    const message =
      row.message && typeof row.message === 'object' ? (row.message as Record<string, unknown>) : {};

    let value = row.aiTitle;

    if (row.type === ClaudeRecordType.Assistant) {
      value = message.model;
    } else if (row.type === ClaudeRecordType.CustomTitle) {
      value = row.customTitle;
    }

    if (
      row.type === ClaudeRecordType.Assistant &&
      (typeof value !== 'string' || value.length > 256 || /[<>]/u.test(value))
    ) {
      return;
    }

    if (typeof value !== 'string' || !value.trim() || ASCII_CONTROL_CHARACTERS.test(value)) {
      return;
    }

    return {
      text: truncateUtf8(value.trim(), row.type === ClaudeRecordType.Assistant ? 256 : 512),
      position,
      start: position - line.length,
      bytes: line.length,
      fingerprint: fingerprint(line),
    };
  }

  async readTail(file: FileHandle, size: number): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    [this.custom, this.generated, this.assistantModel] = await Promise.all([
      this.validate(file, this.custom, ClaudeRecordType.CustomTitle),
      this.validate(file, this.generated, ClaudeRecordType.AiTitle),
      this.validate(file, this.assistantModel, ClaudeRecordType.Assistant),
    ]);

    if (!size) {
      return;
    }

    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    let offset = start ? buffer.indexOf(10) + 1 : 0;

    if (start && !offset) {
      return;
    }

    while (offset < bytesRead) {
      const end = buffer.indexOf(10, offset);

      if (end < 0 || end >= bytesRead) {
        break;
      }

      try {
        const row: unknown = JSON.parse(buffer.toString('utf8', offset, end));

        if (row && typeof row === 'object' && !Array.isArray(row)) {
          this.observe(row as Record<string, unknown>, start + end, buffer.subarray(offset, end));
        }
      } catch {} // ignore: partial or malformed JSONL is never title metadata.

      offset = end + 1;
    }
  }

  private async validate(
    file: FileHandle,
    entry: TitleEntry | undefined,
    expectedType:
      | typeof ClaudeRecordType.CustomTitle
      | typeof ClaudeRecordType.AiTitle
      | typeof ClaudeRecordType.Assistant,
  ): Promise<TitleEntry | undefined> {
    if (!entry) {
      return;
    }

    const buffer = Buffer.alloc(entry.bytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, entry.start);

    if (bytesRead !== buffer.length || buffer[entry.bytes] !== 10) {
      return;
    }

    const line = buffer.subarray(0, entry.bytes);

    if (fingerprint(line) === entry.fingerprint) {
      return entry;
    }

    try {
      const row = JSON.parse(line.toString('utf8')) as Record<string, unknown>;

      if (!row || typeof row !== 'object' || row.type !== expectedType) {
        return;
      }

      return this.entry(row, entry.position, line);
    } catch {
      return;
    }
  }
}
