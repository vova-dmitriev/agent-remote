import { CodexItemType } from '../../domain/codex/codex.js';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { sessionSchema } from '@protocol';
import { object, type Data } from '../events.js';

function records(
  buffer: Buffer,
  skipPartial: boolean,
  start = 0,
): { row: Data; position: number; hash: string }[] {
  const entries: { row: Data; position: number; hash: string }[] = [];
  let offset = skipPartial ? buffer.indexOf(10) + 1 : 0;

  if (skipPartial && !offset) {
    return entries;
  }

  while (offset < buffer.length) {
    const end = buffer.indexOf(10, offset);

    if (end < 0) {
      break;
    }

    const line = buffer.subarray(offset, end);

    try {
      entries.push({
        row: object(JSON.parse(line.toString('utf8'))),
        position: start + offset,
        hash: createHash('sha256').update(line).digest('hex'),
      });
    } catch {
      // Incomplete and malformed native records cannot supply model metadata.
    }

    offset = end + 1;
  }

  return entries;
}

/** Reads only the exact native thread path, within the local Codex sessions directory. */
export class CodexModelReader {
  private fingerprint = '';
  private reading = false;
  private contextIdentity = '';
  constructor(
    private path: unknown,
    private threadId: string,
    private codexHome?: string,
  ) {}

  async read(): Promise<string | undefined> {
    if (this.reading || typeof this.path !== 'string' || !isAbsolute(this.path)) {
      return;
    }

    this.reading = true;

    try {
      const configuredRoot = join(
        this.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'),
        'sessions',
      );

      const [root, path] = await Promise.all([realpath(configuredRoot), realpath(this.path)]);
      const within = relative(root, path);

      if (!within || within === '..' || within.startsWith('../') || isAbsolute(within)) {
        return;
      }

      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

      try {
        const info = await file.stat();

        if (!info.isFile()) {
          return;
        }

        const current = await realpath(this.path),
          currentInfo = await stat(current);

        if (current !== path || currentInfo.dev !== info.dev || currentInfo.ino !== info.ino) {
          return;
        }

        const fingerprint = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;

        if (fingerprint === this.fingerprint) {
          return;
        }

        const prefix = Buffer.alloc(Math.min(info.size, 1_048_576));

        await file.read(prefix, 0, prefix.length, 0);
        const first = records(prefix, false)[0]?.row;

        if (first?.type !== CodexItemType.SessionMeta || object(first.payload).id !== this.threadId) {
          return;
        }

        const start = Math.max(0, info.size - 262_144);
        const tail = Buffer.alloc(info.size - start);

        await file.read(tail, 0, tail.length, start);
        const after = await file.stat();

        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) {
          return;
        }

        this.fingerprint = fingerprint;

        for (const record of records(tail, start > 0, start).reverse()) {
          const row = record.row;

          if (row.type !== CodexItemType.TurnContext) {
            continue;
          }

          const parsed = sessionSchema.shape.model.safeParse(object(row.payload).model);

          if (!parsed.success || !parsed.data) {
            continue;
          }

          const identity = `${info.dev}:${info.ino}:${record.position}:${record.hash}`;

          if (identity === this.contextIdentity) {
            return;
          }

          this.contextIdentity = identity;

          return parsed.data;
        }
      } finally {
        await file.close();
      }
    } catch {
      // Missing or inaccessible native metadata never changes session authority or reveals a path.
    } finally {
      this.reading = false;
    }
  }
}
