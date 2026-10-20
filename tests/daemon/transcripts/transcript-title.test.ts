import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptReader } from '@daemon/code/transcript/transcript-reader.js';

let root: string;
let path: string;

const metadata = (type: string, value: unknown, sessionId = 'session-a') =>
  JSON.stringify({ type, sessionId, [type === 'custom-title' ? 'customTitle' : 'aiTitle']: value }) + '\n';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transcript-title-'));
  path = join(root, 'session-a.jsonl');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function reader(maxReadBytes = 1_048_576) {
  return new TranscriptReader({ path, allowedRoot: root, sessionId: 'session-a', maxReadBytes });
}

describe('Claude transcript title metadata', () => {
  it('uses the latest explicit title for the exact session and keeps metadata out of history', async () => {
    await writeFile(
      path,
      metadata('ai-title', 'Generated title') + metadata('custom-title', 'Initial title'),
    );

    const source = reader();

    expect(await source.readNext()).toEqual([]);
    expect(source.title).toBe('Initial title');

    await appendFile(
      path,
      metadata('custom-title', 'Renamed session') + metadata('ai-title', 'Later AI title'),
    );

    await source.readNext();
    expect(source.title).toBe('Renamed session');
  });

  it('finds the latest title in a bounded tail before history replay catches up', async () => {
    await writeFile(
      path,
      metadata('ai-title', 'Old title') + 'x'.repeat(300_000) + '\n' + metadata('ai-title', 'Current title'),
    );

    const source = reader(256);

    await source.readNext();
    expect(source.title).toBe('Current title');
    await source.readNext();
    expect(source.title).toBe('Current title');
  });

  it('never derives titles from messages, summaries or another session', async () => {
    await writeFile(
      path,
      [
        JSON.stringify({
          type: 'user',
          sessionId: 'session-a',
          message: { content: 'Do not use this prompt' },
        }),
        JSON.stringify({ type: 'summary', summary: 'Unbound summary', leafUuid: 'other-leaf' }),
        metadata('custom-title', 'Foreign title', 'session-b').trim(),
      ].join('\n') + '\n',
    );

    const source = reader();

    await source.readNext();
    expect(source.title).toBeUndefined();
    await appendFile(path, metadata('ai-title', '  Exact session title  '));
    await source.readNext();
    expect(source.title).toBe('Exact session title');
  });

  it('ignores invalid metadata and bounds long UTF-8 titles', async () => {
    await writeFile(
      path,
      metadata('ai-title', 'Valid title') + metadata('custom-title', '   ') + metadata('custom-title', 4),
    );

    const source = reader();

    await source.readNext();
    expect(source.title).toBe('Valid title');
    await appendFile(path, metadata('custom-title', '👋'.repeat(200)));
    await source.readNext();
    expect(source.title).toBe('👋'.repeat(128));
  });

  it('clears metadata on file replacement and buffers incomplete metadata', async () => {
    await writeFile(path, metadata('custom-title', 'Before replacement'));
    const source = reader();

    await source.readNext();
    await rename(path, path + '.old');
    await writeFile(path, metadata('ai-title', 'After replacement').trimEnd());
    await source.readNext();
    expect(source.title).toBeUndefined();
    await appendFile(path, '\n');
    await source.readNext();
    expect(source.title).toBe('After replacement');
  });

  it('discards a removed custom title when a growing rewrite retains the prefix and cursor anchor', async () => {
    const prefix = 'p'.repeat(5_000) + '\n';
    const custom = metadata('custom-title', 'Removed custom title');
    const suffix = 's'.repeat(5_000) + '\n';

    await writeFile(path, prefix + custom + suffix);
    const source = reader();

    await source.readNext();
    expect(source.title).toBe('Removed custom title');
    const replacement = '{"type":"ignored"}'.padEnd(custom.length - 1) + '\n';

    await writeFile(path, prefix + replacement + suffix + metadata('ai-title', 'Current AI title'));
    await source.readNext();
    expect(source.title).toBe('Current AI title');
  });

  it('preserves a valid cached AI fallback outside the tail when a custom title is removed', async () => {
    const generated = metadata('ai-title', 'Existing AI title');
    const prefix = 'p'.repeat(5_000) + '\n' + generated + 'm'.repeat(300_000) + '\n';
    const custom = metadata('custom-title', 'Removed custom title');
    const suffix = 's'.repeat(5_000) + '\n';

    await writeFile(path, prefix + custom + suffix);
    const source = reader();

    await source.readNext();
    expect(source.title).toBe('Removed custom title');
    const replacement = '{"type":"ignored"}'.padEnd(custom.length - 1) + '\n';

    await writeFile(path, prefix + replacement + suffix + '{"type":"ignored"}\n');
    await source.readNext();
    expect(source.title).toBe('Existing AI title');
  });

  it('rereads a renamed custom title outside the tail when a growing rewrite retains both anchors', async () => {
    const prefix = 'p'.repeat(5_000) + '\n';
    const suffix = 's'.repeat(300_000) + '\n';

    await writeFile(path, prefix + metadata('custom-title', 'Old title') + suffix);
    const source = reader();

    await source.readNext();
    expect(source.title).toBe('Old title');
    await writeFile(path, prefix + metadata('custom-title', 'New title') + suffix + '{"type":"ignored"}\n');
    await source.readNext();
    expect(source.title).toBe('New title');
    await source.readNext();
    expect(source.title).toBe('New title');
  });

  it.each([metadata('custom-title', 'New title', 'session-b'), metadata('ai-title', 'New title')])(
    'rejects rewritten metadata with a different source session or type',
    async (replacement) => {
      const prefix = 'p'.repeat(5_000) + '\n';
      const suffix = 's'.repeat(300_000) + '\n';
      const original = metadata('custom-title', 'Old title');

      await writeFile(path, prefix + original + suffix);
      const source = reader();

      await source.readNext();
      expect(source.title).toBe('Old title');

      await writeFile(
        path,
        prefix + replacement.trimEnd().padEnd(original.length - 1) + '\n' + suffix + '{}\n',
      );

      await source.readNext();
      expect(source.title).toBeUndefined();
    },
  );
});

describe('naming a Claude session in its transcript', () => {
  it('appends the record /rename writes, which the reader then shows over any generated title', async () => {
    const { appendCustomTitle } = await import('@daemon/code/transcript/transcript-title.js');
    const { readFile } = await import('node:fs/promises');

    await writeFile(path, metadata('ai-title', 'Generated title'));
    const source = reader();

    await source.readNext();
    await appendCustomTitle(path, root, 'session-a', 'Named in the app');

    expect((await readFile(path, 'utf8')).split('\n').at(-2)).toBe(
      JSON.stringify({ type: 'custom-title', customTitle: 'Named in the app', sessionId: 'session-a' }),
    );

    await source.readNext();
    expect(source.title).toBe('Named in the app');
  });

  it('also writes the private title file Claude Code reads for its session list', async () => {
    const { appendCustomTitle } = await import('@daemon/code/transcript/transcript-title.js');
    const { readFile, stat } = await import('node:fs/promises');
    const sidecar = join(root, 'session-a', 'custom-title.json');

    await writeFile(path, metadata('ai-title', 'Generated title'));
    await appendCustomTitle(path, root, 'session-a', 'First name');
    await appendCustomTitle(path, root, 'session-a', 'Named in the app');

    expect(JSON.parse(await readFile(sidecar, 'utf8'))).toEqual({ customTitle: 'Named in the app' });
    expect((await stat(sidecar)).mode & 0o777).toBe(0o600);

    await expect(appendCustomTitle(path, root, '../escape', 'Name')).rejects.toThrow(
      'TRANSCRIPT_UNAVAILABLE',
    );
  });

  it('never joins a line Claude is still writing, and never writes outside the transcript root', async () => {
    const { appendCustomTitle } = await import('@daemon/code/transcript/transcript-title.js');

    await writeFile(path, metadata('ai-title', 'Generated title') + '{"type":"assist');

    await expect(appendCustomTitle(path, root, 'session-a', 'Name')).rejects.toThrow(
      'TRANSCRIPT_UNAVAILABLE',
    );

    const outside = await mkdtemp(join(tmpdir(), 'transcript-outside-'));

    try {
      await writeFile(join(outside, 'other.jsonl'), '');

      await expect(
        appendCustomTitle(join(outside, 'other.jsonl'), root, 'session-a', 'Name'),
      ).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
