import { expect, it } from 'vitest';
import { TranscriptSources } from '@daemon/monitor/history.js';

it('does not remove a replacement reader when a stale asynchronous read fails', () => {
  const sources = new TranscriptSources('/synthetic');
  const stale = sources.open('session', 'generation', '/synthetic/old.jsonl', 'source');
  const current = sources.open('session', 'generation', '/synthetic/new.jsonl', 'source');

  sources.delete('session', stale);
  expect([...sources.entries()]).toEqual([['session', current]]);
  sources.delete('session', current);
  expect([...sources.entries()]).toEqual([]);
});

it('passes a durable source position to live attachment normalization without marking live messages as history pages', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'live-source-position-'));

  try {
    const path = join(root, 'source.jsonl');

    await writeFile(
      path,
      JSON.stringify({
        type: 'user',
        sessionId: 'source',
        uuid: 'm',
        message: { content: 'Synthetic' },
        timestamp: new Date(1).toISOString(),
      }) + '\n',
    );

    let position: string | undefined;

    const sources = new TranscriptSources(root, async (_id, _generation, message) => {
      position = message.historyCursor;

      return message;
    });

    const messages = await sources.open('session', 'generation', path, 'source').readNext();

    expect(position).toMatch(/^position:/);
    expect(messages).toEqual([{ id: 'm', role: 'user', text: 'Synthetic', occurredAt: 1 }]);

    const page = await sources.page({
      type: 'history_read',
      requestId: 'r',
      sessionId: 'session',
      generation: 'generation',
      direction: 'message',
      anchor: position!,
    });

    expect(page.messages.map((message) => message.id)).toEqual(['m']);
    expect(page.messages[0]!.historyCursor).toBe(position);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
