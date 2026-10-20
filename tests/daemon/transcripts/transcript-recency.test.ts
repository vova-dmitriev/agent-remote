import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptSources } from '@daemon/monitor/history.js';

const row = (id: string, time: number, type = 'assistant', extra = {}) =>
  JSON.stringify({
    sessionId: 'source',
    uuid: id,
    type,
    timestamp: new Date(time).toISOString(),
    message: { content: [{ type: 'text', text: 'Synthetic message' }] },
    ...extra,
  }) + '\n';

it('publishes the newest native message time before a large history import finishes, without importing message bodies twice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recency-'));

  try {
    const path = join(root, 'source.jsonl'),
      old = 1700000000000,
      latest = old + 100000;

    await writeFile(
      path,
      row('old', old) +
        JSON.stringify({ type: 'api-request-blob', data: 'x'.repeat(3 * 1024 * 1024) }) +
        '\n' +
        row('latest', latest) +
        row('foreign', latest + 10000, 'assistant', { sessionId: 'other' }) +
        row('meta', latest + 20000, 'user', { isMeta: true }) +
        row('tool', latest + 30000, 'user', {
          message: { content: [{ type: 'tool_result', content: 'Synthetic output' }] },
        }),
    );

    const observed: number[] = [];

    const sources = new TranscriptSources(
      root,
      async (_id, _generation, message) => message,
      (_id, _generation, time) => {
        observed.push(time);
      },
    );

    const reader = sources.open('remote', 'generation', path, 'source');

    await sources.refreshActivity();
    expect(observed.at(-1)).toBe(latest);
    expect((await reader.readNext()).map((message) => message.id)).toEqual(['old', 'latest']);
    await appendFile(path, row('newer', latest + 40000));
    await sources.refreshActivity();
    expect(observed.at(-1)).toBe(latest + 40000);
    sources.delete('remote');
    await sources.refreshActivity();
    expect(observed).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps recency independent of a blocked attachment/history transform and discards a stale source callback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recency-blocked-'));
  let release!: () => void, started!: () => void;

  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered = new Promise<void>((resolve) => {
      started = resolve;
    });

  try {
    const path = join(root, 'source.jsonl'),
      old = 1700000000000,
      latest = old + 100000;

    await writeFile(path, row('old', old));
    const observed: number[] = [];

    const sources = new TranscriptSources(
      root,
      async (_id, _generation, message) => {
        started();
        await gate;

        return message;
      },
      (_id, _generation, time) => {
        observed.push(time);
      },
    );

    const pending = sources.open('remote', 'generation', path, 'source').readNext();

    await entered;
    await appendFile(path, row('latest', latest));
    await sources.refreshActivity();
    expect(observed.at(-1)).toBe(latest);
    const stale = sources.refreshActivity();

    sources.delete('remote');
    await stale;
    expect(observed).toHaveLength(1);
    release();
    expect((await pending).map((message) => message.id)).toEqual(['old']);
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});
