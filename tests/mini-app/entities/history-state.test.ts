import { describe, it, expect } from 'vitest';
import { MessageTracker, TranscriptSources } from '@daemon/monitor/history.js';
import { initialState, reduceSessionState } from '@/entities/session/model/session-state.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('source history recovery', () => {
  it('binds title metadata to the original Claude session rather than the local monitor ID', async () => {
    const root = await mkdtemp(join(tmpdir(), 'history-title-'));

    try {
      const path = join(root, 'source.jsonl');

      await writeFile(
        path,
        JSON.stringify({ type: 'ai-title', aiTitle: 'Original context', sessionId: 'claude-original' }) +
          '\n',
      );

      const sources = new TranscriptSources(root);
      const reader = sources.open('monitor-local', 'generation', path, 'claude-original');

      await reader.readNext();
      expect(reader.title).toBe('Original context');
      const rebound = sources.open('monitor-local', 'generation', path, 'different-source');

      await rebound.readNext();
      expect(rebound.title).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('suppresses identical polls but accepts a changed message in place', () => {
    const tracker = new MessageTracker();
    const message = { id: 'a', role: 'assistant' as const, text: 'draft', occurredAt: 1 };

    expect(tracker.accept(message)).toBe(true);
    expect(tracker.accept({ ...message, occurredAt: 2 })).toBe(false);
    expect(tracker.accept({ ...message, text: 'complete' })).toBe(true);
  });

  it('rebinds transcript path and generation rather than continuing the old reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'history-rebind-'));

    try {
      const one = join(root, 'one.jsonl'),
        two = join(root, 'two.jsonl');

      const row = (id: string) =>
        JSON.stringify({ type: 'assistant', uuid: id, message: { content: id } }) + '\n';

      await writeFile(one, row('one'));
      await writeFile(two, row('two'));
      const sources = new TranscriptSources(root);

      expect((await sources.open('s', 'g1', one).readNext())[0]?.text).toBe('one');
      expect((await sources.open('s', 'g2', two).readNext())[0]?.text).toBe('two');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('updates streaming text for the same message ID in the browser store', () => {
    let state: ReturnType<typeof initialState> = { ...initialState(), deviceId: 'd' };

    const event = {
      version: 1 as const,
      deviceId: 'd',
      streamId: 's',
      seq: 1,
      eventId: 'event',
      sessionId: 'chat',
      occurredAt: 1,
      type: 'message',
      payload: { id: 'same', role: 'assistant', text: 'draft', occurredAt: 1 },
    };

    state = reduceSessionState(state, { type: 'event', event });

    state = reduceSessionState(state, {
      type: 'event',
      event: { ...event, seq: 2, payload: { ...event.payload, text: 'complete' } },
    });

    expect(state.messages.chat?.map((m) => m.text)).toEqual(['complete']);
  });
});

it('does not overwrite a live streaming update with an older history page', () => {
  let state: ReturnType<typeof initialState> = { ...initialState(), deviceId: 'd' };

  const event = {
    version: 1 as const,
    deviceId: 'd',
    streamId: 's',
    seq: 2,
    eventId: 'new',
    sessionId: 'chat',
    occurredAt: 2,
    type: 'message',
    payload: { id: 'same', role: 'assistant', text: 'complete', occurredAt: 1 },
  };

  state = reduceSessionState(state, { type: 'event', event });

  state = reduceSessionState(state, {
    type: 'event',
    event: { ...event, seq: 1, eventId: 'old', payload: { ...event.payload, text: 'draft' } },
  });

  expect(state.messages.chat?.[0]?.text).toBe('complete');
});
