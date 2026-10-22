import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORY_OUTLINE_TEXT_CHARS } from '@protocol';
import { TranscriptPages } from '@daemon/code/transcript/transcript-pages.js';

const row = (i: number, text = 'Synthetic ' + i) =>
  JSON.stringify({
    type: i % 2 ? 'assistant' : 'user',
    sessionId: 'source',
    uuid: 'm' + i,
    timestamp: new Date(i + 1).toISOString(),
    message: { content: text },
  }) + '\n';

it("outlines every owner's message past a page and opens a window around one of them", async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-outline-'));

  try {
    const path = join(root, 'source.jsonl');
    const long = 'x'.repeat(HISTORY_OUTLINE_TEXT_CHARS * 2);

    await writeFile(path, Array.from({ length: 420 }, (_, i) => row(i, i === 4 ? long : undefined)).join(''));
    const pages = new TranscriptPages({ path, allowedRoot: root, sessionId: 'source' });
    const outline = await pages.page({ direction: 'outline' });

    expect(outline.messages.map((message) => message.id)).toEqual(
      Array.from({ length: 210 }, (_, i) => 'm' + i * 2),
    );

    expect(outline.messages[2]!.text).toHaveLength(HISTORY_OUTLINE_TEXT_CHARS);
    expect(outline.messages.every((message) => message.historyCursor?.startsWith('position:'))).toBe(true);

    const around = await pages.page({ direction: 'around', anchor: outline.messages[10]!.historyCursor! });

    expect(around.messages.map((message) => message.id)).toContain('m20');
    expect(around.messages[0]!.id).toBe('m0');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
