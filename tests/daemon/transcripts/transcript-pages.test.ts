import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptPages } from '@daemon/code/transcript/transcript-pages.js';

it('reads latest and adjacent native pages and restores a saved byte cursor without replaying old messages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-pages-'));

  try {
    const path = join(root, 'source.jsonl');

    const rows = Array.from(
      { length: 420 },
      (_, i) =>
        JSON.stringify({
          type: 'assistant',
          sessionId: 'source',
          uuid: 'm' + i,
          timestamp: new Date(i + 1).toISOString(),
          message: { content: 'Synthetic ' + i },
        }) + '\n',
    );

    await writeFile(
      path,
      JSON.stringify({ type: 'progress', padding: 'x'.repeat(8 * 1024 * 1024) }) + '\n' + rows.join(''),
    );

    let transformed = 0;

    const pages = new TranscriptPages({
      path,
      allowedRoot: root,
      sessionId: 'source',
      transform: async (message) => {
        transformed++;

        return message;
      },
    });

    const recent = await pages.page({ direction: 'latest' });

    expect(recent.messages.map((message) => message.id)).toEqual(
      Array.from({ length: 100 }, (_, i) => 'm' + (320 + i)),
    );

    expect(transformed).toBe(100);
    expect(recent.before).toBeTruthy();
    expect(recent.after).toBeNull();
    transformed = 0;
    const single = await pages.page({ direction: 'message', anchor: recent.messages[20]!.historyCursor! });

    expect(single.messages.map((message) => message.id)).toEqual(['m340']);
    expect(transformed).toBe(1);
    const older = await pages.page({ direction: 'before', anchor: recent.before! });

    expect(older.messages.map((message) => message.id)).toEqual(
      Array.from({ length: 100 }, (_, i) => 'm' + (220 + i)),
    );

    const newer = await pages.page({ direction: 'after', anchor: older.after! });

    expect(newer.messages.map((message) => message.id)).toEqual(recent.messages.map((message) => message.id));
    const reopened = new TranscriptPages({ path, allowedRoot: root, sessionId: 'source' });
    const saved = await reopened.page({ direction: 'around', anchor: recent.messages[20]!.historyCursor! });

    expect(saved.messages[49]!.id).toBe('m340');
    expect(saved.before).toBeTruthy();
    expect(saved.after).toBeTruthy();

    await expect(
      reopened.page({
        direction: 'before',
        anchor: Buffer.from(JSON.stringify({ dev: 0, ino: 0, offset: 1 })).toString('base64url'),
      }),
    ).rejects.toThrow('TRANSCRIPT_CHANGED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('reads an empty history for a session Claude has not written a transcript for yet', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-pages-'));

  try {
    const path = join(root, 'not-written-yet.jsonl');
    const pages = new TranscriptPages({ path, allowedRoot: root, emptyUntilWritten: true });
    const empty = { messages: [], before: null, after: null };

    await expect(pages.page({ direction: 'latest' })).resolves.toEqual(empty);
    await expect(pages.page({ direction: 'outline' })).resolves.toEqual(empty);

    // A subagent's transcript is read only once listed: a missing one stays unavailable.
    await expect(
      new TranscriptPages({ path, allowedRoot: root }).page({ direction: 'latest' }),
    ).rejects.toThrow('TRANSCRIPT_UNAVAILABLE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
