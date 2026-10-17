import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptReader } from '../apps/daemon/src/code/transcript-reader.js';

let root: string;
let allowed: string;
let file: string;

const message = (id: string, text: string) =>
  JSON.stringify({
    type: 'assistant',
    uuid: id,
    timestamp: '2026-10-16T12:00:00Z',
    message: { content: [{ type: 'text', text }] },
  }) + '\n';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claude-transcript-'));
  allowed = join(root, 'claude');
  await mkdir(allowed);
  file = join(allowed, 'session.jsonl');
  await writeFile(file, '');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('TranscriptReader', () => {
  it('buffers partial UTF-8 JSONL and emits only visible text once', async () => {
    const row = Buffer.from(
      JSON.stringify({
        type: 'assistant',
        uuid: 'a',
        timestamp: '2026-10-16T12:00:00Z',
        message: {
          content: [
            { type: 'thinking', thinking: 'private' },
            { type: 'text', text: 'Привет 👋' },
            { type: 'tool_use', name: 'Bash', input: { command: 'secret' } },
          ],
        },
      }) + '\n',
    );

    const split = row.indexOf(Buffer.from('👋')) + 2;

    await writeFile(file, row.subarray(0, split));
    const reader = new TranscriptReader({ path: file, allowedRoot: allowed });

    expect(await reader.readNext()).toEqual([]);
    await appendFile(file, row.subarray(split));

    expect(await reader.readNext()).toEqual([
      { id: 'a', role: 'assistant', text: 'Привет 👋', occurredAt: 1_792_152_000_000 },
    ]);

    expect(await reader.readNext()).toEqual([]);
  });

  it('skips malformed, hidden and oversized records then resumes', async () => {
    await writeFile(
      file,
      'x'.repeat(600) +
        '\ninvalid-json\n' +
        JSON.stringify({ type: 'progress', data: 'private' }) +
        '\n' +
        message('ok', 'visible'),
    );

    const reader = new TranscriptReader({ path: file, allowedRoot: allowed, maxLineBytes: 256 });

    expect((await reader.readNext()).map((m) => m.text)).toEqual(['visible']);
  });

  it('recovers after file replacement and suppresses duplicate message UUIDs', async () => {
    const reader = new TranscriptReader({ path: file, allowedRoot: allowed });

    await writeFile(file, message('a', 'first'));
    expect((await reader.readNext()).map((m) => m.id)).toEqual(['a']);
    await rename(file, file + '.old');
    await writeFile(file, message('a', 'first') + message('b', 'second'));
    expect((await reader.readNext()).map((m) => m.id)).toEqual(['b']);
    await writeFile(file, '');
    expect(await reader.readNext()).toEqual([]);
    await appendFile(file, message('c', 'third'));
    expect((await reader.readNext()).map((m) => m.id)).toEqual(['c']);
  });

  it('detects same-size in-place rewrites even with an unchanged cursor anchor', async () => {
    const padding = 'x'.repeat(100) + '\n';

    await writeFile(file, message('a', 'one') + padding);
    const reader = new TranscriptReader({ path: file, allowedRoot: allowed });

    expect((await reader.readNext()).map((m) => m.id)).toEqual(['a']);
    await writeFile(file, message('b', 'two') + padding);
    expect((await reader.readNext()).map((m) => m.id)).toEqual(['b']);
  });

  it('detects a truncated file rewritten past the previous size', async () => {
    const padding = 'x'.repeat(100) + '\n';

    await writeFile(file, message('a', 'one') + padding);
    const reader = new TranscriptReader({ path: file, allowedRoot: allowed });

    expect((await reader.readNext()).map((m) => m.id)).toEqual(['a']);
    await writeFile(file, message('b', 'two') + padding + message('c', 'new'));
    expect((await reader.readNext()).map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('rejects symlinks that point outside the allowed Claude directory', async () => {
    const outside = join(root, 'outside.jsonl');

    await writeFile(outside, message('x', 'private'));
    const link = join(allowed, 'link.jsonl');

    await symlink(outside, link);
    const reader = new TranscriptReader({ path: link, allowedRoot: allowed });

    await expect(reader.readNext()).rejects.toThrow('TRANSCRIPT_OUTSIDE_ROOT');
  });

  it('serializes concurrent reads without returning duplicate records', async () => {
    await writeFile(file, message('a', 'one'));
    const reader = new TranscriptReader({ path: file, allowedRoot: allowed });
    const results = await Promise.all([reader.readNext(), reader.readNext()]);

    expect(results.flat().map((m) => m.id)).toEqual(['a']);
  });

  it('keeps text truncation on a complete UTF-8 character', async () => {
    await writeFile(file, message('a', '👋👋'));
    const reader = new TranscriptReader({ path: file, allowedRoot: allowed, maxTextBytes: 5 });

    expect((await reader.readNext())[0]?.text).toBe('👋');
  });
});
