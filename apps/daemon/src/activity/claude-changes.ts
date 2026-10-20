import { FileChangeKind } from '@protocol';
import type { FileHandle } from 'node:fs/promises';
import type { FileChangeLog, FileEdit } from './file-changes.js';

/** How much of a transcript's end is searched for edits made before the daemon attached. */
const TAIL_BYTES = 4 * 1024 * 1024;
const TOOL_RESULT = '"toolUseResult"';
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

  return {
    id: row.uuid,
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

/** Lists the edits in the last few megabytes of a transcript, for a reader that starts at its end. */
export async function readEditsTail(
  file: FileHandle,
  size: number,
  sessionId: string | undefined,
  log: FileChangeLog,
) {
  const start = Math.max(0, size - TAIL_BYTES);
  const buffer = Buffer.alloc(size - start);
  const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
  const text = buffer.toString('utf8', 0, bytesRead);
  const lines = text.split('\n');

  // The first line may be cut by the window and the last may still be written.
  for (const line of lines.slice(start ? 1 : 0, -1)) {
    if (!line.includes(TOOL_RESULT)) {
      continue;
    }

    try {
      const row = record(JSON.parse(line));
      const edit = row && claudeFileEdit(row, sessionId);

      if (edit) {
        log.add(edit, true);
      }
    } catch {} // ignore: a malformed line is never an edit.
  }
}
