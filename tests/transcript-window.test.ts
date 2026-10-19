import { expect, it } from 'vitest';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptReader } from '../apps/daemon/src/code/transcript-reader.js';

it('starts at recent messages without replaying the backlog, including after resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recent-window-'));

  try {
    const path = join(root, 'source.jsonl');

    const row = (id: number) =>
      JSON.stringify({
        type: 'assistant',
        sessionId: 'source',
        uuid: String(id),
        timestamp: new Date(id + 1).toISOString(),
        message: { content: 'Synthetic ' + id },
      }) + '\n';

    await writeFile(
      path,
      row(0) +
        JSON.stringify({ type: 'progress', padding: 'x'.repeat(8 * 1024 * 1024) }) +
        '\n' +
        Array.from({ length: 120 }, (_, i) => row(i + 1)).join('') +
        Array.from(
          { length: 200 },
          () =>
            JSON.stringify({
              type: 'attachment',
              sessionId: 'source',
              attachment: { type: 'task_notification', content: 'Synthetic internal status' },
            }) + '\n',
        ).join(''),
    );

    let normalized = 0;

    const options = {
      path,
      allowedRoot: root,
      sessionId: 'source',
      initialWindow: 30,
      transform: async (message: import('@protocol').HistoryMessage) => {
        normalized++;

        return message;
      },
    };

    const reader = new TranscriptReader(options);

    expect((await reader.readNext()).map((message) => message.id)).toEqual(
      Array.from({ length: 30 }, (_, i) => String(i + 91)),
    );

    expect(normalized).toBe(30);
    expect(await reader.readNext()).toEqual([]);
    await appendFile(path, row(121));
    expect((await reader.readNext()).map((message) => message.id)).toEqual(['121']);
    expect(normalized).toBe(31);
    const resumed = new TranscriptReader(options);

    expect((await resumed.readNext()).at(-1)?.id).toBe('121');
    expect(normalized).toBe(61);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
