import { afterEach, beforeEach, expect, it } from 'vitest';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionChangesSchema } from '@protocol';
import { TranscriptReader } from '@daemon/code/transcript/transcript-reader.js';

let root: string;
let path: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transcript-changes-'));
  path = join(root, 'session-a.jsonl');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A tool result line as Claude Code writes it after Edit or Write. */
const edited = (uuid: string, filePath: string, type?: string, sessionId = 'session-a') =>
  JSON.stringify({
    type: 'user',
    uuid,
    sessionId,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-' + uuid, content: 'ok' }] },
    toolUseResult: {
      ...(type ? { type } : {}),
      filePath,
      originalFile: 'old file text',
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-old', '+new', '+more'] },
      ],
    },
  }) + '\n';

const reader = () =>
  new TranscriptReader({
    path,
    allowedRoot: root,
    sessionId: 'session-a',
    initialWindow: 0,
    editsTail: true,
  });

it('lists the files Claude edited, including ones edited before the reader attached', async () => {
  await writeFile(
    path,
    edited('1', '/work/README.md', 'create') + edited('2', '/work/other.md', 'update', 'session-b'),
  );

  const source = reader();

  await source.readNext();
  await appendFile(path, edited('3', '/work/src/app.ts'));
  await source.readNext();

  const changes = source.changes!;

  expect(sessionChangesSchema.safeParse(changes).success).toBe(true);

  expect(changes.files.map((file) => [file.path, file.kind])).toEqual([
    ['/work/README.md', 'add'],
    ['/work/src/app.ts', 'update'],
  ]);

  expect(changes.files[1]!.patch).toBe('@@ -1,1 +1,2 @@\n-old\n+new\n+more');
});

it('shows a new file written in one go as added lines', async () => {
  const created = JSON.parse(edited('1', '/work/NOTES.md', 'create'));

  created.toolUseResult.structuredPatch = [];
  created.toolUseResult.content = '# Notes\nfirst';
  await writeFile(path, JSON.stringify(created) + '\n');

  const source = reader();

  await source.readNext();
  expect(source.changes!.files[0]!.patch).toBe('+# Notes\n+first');
});

it('reports no changes for a session that edited nothing', async () => {
  await writeFile(
    path,
    JSON.stringify({ type: 'user', sessionId: 'session-a', message: { content: 'hi' } }) + '\n',
  );

  const source = reader();

  await source.readNext();
  expect(source.changes).toBeUndefined();
});

it('finds an edit far back in a long transcript and lists each file once, with its latest edit', async () => {
  const filler =
    JSON.stringify({
      type: 'assistant',
      sessionId: 'session-a',
      message: { content: 'x'.repeat(1024 * 1024) },
    }) + '\n';

  await writeFile(
    path,
    edited('1', '/work/DESIGN.md', 'create') + filler.repeat(6) + edited('2', '/work/app.ts'),
  );

  await appendFile(path, edited('3', '/work/app.ts'));

  const source = reader();

  await source.readNext();
  expect(source.changes!.files.map((file) => file.path)).toEqual(['/work/DESIGN.md', '/work/app.ts']);
});

it('keeps every changed file listed when patches outgrow the budget, dropping the oldest patches first', async () => {
  const { FileChangeLog } = await import('@daemon/activity/file-changes.js');
  const log = new FileChangeLog();

  for (let index = 0; index < 30; index++) {
    log.add({ id: String(index), path: `/work/${index}.md`, kind: 'update', diff: '+line\n'.repeat(1000) });
  }

  const { files, truncated } = log.value();

  expect(files).toHaveLength(30);
  expect(truncated).toBe(true);
  expect(files[0]!.patch).toBe('');
  expect(files.at(-1)!.patch).not.toBe('');
  expect(Buffer.byteLength(JSON.stringify(log.value()))).toBeLessThanOrEqual(16384);
});
