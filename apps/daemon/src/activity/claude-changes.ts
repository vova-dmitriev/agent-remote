import { FileChangeKind } from '@protocol';
import type { FileHandle } from 'node:fs/promises';
import type { FileChangeLog, FileEdit } from './file-changes.js';

/** Read size for the one pass over a transcript that lists edits made before the daemon attached. */
const CHUNK_BYTES = 1024 * 1024;
const PATCH_FIELD = '"structuredPatch"';
const CREATED = 'create';

const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** The unified diff of Claude's `structuredPatch` hunks. */
function unifiedDiff(hunks: unknown[]) {
  return hunks
    .map(record)
    .filter((hunk) => hunk && Array.isArray(hunk.lines))
    .map(
      (hunk) =>
        `@@ -${hunk!.oldStart},${hunk!.oldLines} +${hunk!.newStart},${hunk!.newLines} @@\n` +
        (hunk!.lines as unknown[]).map(String).join('\n'),
    )
    .join('\n');
}

/** An Edit or Write result line of this session: Claude Code records the file and its patch with the tool result. */
export function claudeFileEdit(
  row: Record<string, unknown>,
  sessionId: string | undefined,
): FileEdit | undefined {
  const result = record(row.toolUseResult);

  if (
    !result ||
    (sessionId !== undefined && row.sessionId !== sessionId) ||
    typeof row.uuid !== 'string' ||
    typeof result.filePath !== 'string' ||
    !Array.isArray(result.structuredPatch)
  ) {
    return;
  }

  const created = result.type === CREATED;
  const content = typeof result.content === 'string' ? result.content : '';

  // One row per file: a later edit of the same file replaces the earlier one.
  return {
    id: result.filePath,
    path: result.filePath,
    kind: created ? FileChangeKind.Add : FileChangeKind.Update,
    // A new file's patch is empty; its content is the change.
    diff:
      created && !result.structuredPatch.length && content
        ? content
            .split('\n')
            .map((line) => '+' + line)
            .join('\n')
        : unifiedDiff(result.structuredPatch),
  };
}

/** Lists a transcript's edits in one pass, for a reader that starts at its end; only edit lines are parsed. */
export async function readEditsTail(
  file: FileHandle,
  size: number,
  sessionId: string | undefined,
  log: FileChangeLog,
) {
  const chunk = Buffer.alloc(CHUNK_BYTES);
  let carry = '';

  for (let position = 0; position < size;) {
    const { bytesRead } = await file.read(chunk, 0, Math.min(CHUNK_BYTES, size - position), position);

    if (!bytesRead) {
      break;
    }

    position += bytesRead;

    const lines = (carry + chunk.toString('utf8', 0, bytesRead)).split('\n');

    // The last piece may be a line cut by the chunk, or one Claude is still writing.
    carry = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.includes(PATCH_FIELD)) {
        continue;
      }

      try {
        const row = record(JSON.parse(line));
        const edit = row && claudeFileEdit(row, sessionId);

        if (edit) {
          log.add(edit);
        }
      } catch {} // ignore: a malformed line is never an edit.
    }
  }
}
