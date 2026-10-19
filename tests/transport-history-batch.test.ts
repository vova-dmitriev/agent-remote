import { expect, it } from 'vitest';
import { restoreHistoryWindow } from '../apps/mini-app/src/entities/session/api/history.js';
import type { EventEnvelope, ServerFrame } from '@protocol';

it('publishes a history response as one batch for synchronous external stores', async () => {
  const events: EventEnvelope[] = [1, 2].map((seq) => ({
    version: 1,
    deviceId: 'device',
    streamId: 'stream',
    seq,
    eventId: 'event-' + seq,
    sessionId: 'session',
    occurredAt: seq,
    type: 'message',
    payload: { id: 'message-' + seq, role: 'assistant', text: 'Synthetic', occurredAt: seq },
  }));

  const frames: ServerFrame[] = [],
    batches: EventEnvelope[][] = [];

  await restoreHistoryWindow('session', Promise.resolve(events), () => true, {
    onFrame: (frame) => frames.push(frame),
    onHistory: (_sessionId, batch) => batches.push(batch),
  });

  expect(batches).toEqual([events]);
  expect(frames).toEqual([]);

  await restoreHistoryWindow('session', Promise.resolve(events), () => false, {
    onFrame: (frame) => frames.push(frame),
    onHistory: (_sessionId, batch) => batches.push(batch),
  });

  expect(batches).toHaveLength(1);
});
