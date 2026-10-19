import { afterEach, beforeEach, expect, it } from 'vitest';
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptReader } from '../apps/daemon/src/code/transcript/transcript-reader.js';

let root: string, path: string;

const assistant = (model: unknown, sessionId = 'source', extra = {}) =>
  JSON.stringify({ type: 'assistant', sessionId, message: { model, content: [] }, ...extra }) + '\n';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transcript-model-'));
  path = join(root, 'source.jsonl');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('reads the latest assistant model for the exact session before history replay catches up', async () => {
  await writeFile(path, assistant('claude-old') + 'x'.repeat(300_000) + '\n' + assistant('claude-current'));
  const reader = new TranscriptReader({ path, allowedRoot: root, sessionId: 'source', maxReadBytes: 256 });

  expect(await reader.readNext()).toEqual([]);
  expect(reader.model).toBe('claude-current');
  await appendFile(path, assistant('claude-next') + assistant('foreign', 'other'));
  await reader.readNext();
  expect(reader.model).toBe('claude-next');
});

it('ignores synthetic, user, invalid and other-session model metadata', async () => {
  await writeFile(
    path,
    [
      assistant('<synthetic>'),
      assistant('x'.repeat(257)),
      assistant('  '),
      assistant('foreign', 'other'),
      assistant('user-model', 'source', { type: 'user' }),
      JSON.stringify({ type: 'system', sessionId: 'source', model: 'default' }),
    ].join('\n'),
  );

  const reader = new TranscriptReader({ path, allowedRoot: root, sessionId: 'source' });

  await reader.readNext();
  expect(reader.model).toBeUndefined();
});

it('clears stale model metadata on replacement and waits for a complete record', async () => {
  await writeFile(path, assistant('claude-before'));
  const reader = new TranscriptReader({ path, allowedRoot: root, sessionId: 'source' });

  await reader.readNext();
  expect(reader.model).toBe('claude-before');
  await rename(path, path + '.old');
  await writeFile(path, assistant('claude-after').trimEnd());
  await reader.readNext();
  expect(reader.model).toBeUndefined();
  await appendFile(path, '\n');
  await reader.readNext();
  expect(reader.model).toBe('claude-after');
});
