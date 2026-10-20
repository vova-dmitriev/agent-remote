import { expect, it } from 'vitest';
import {
  desktopItemTime,
  historyTurnTimes,
} from '../../../../apps/daemon/src/codex/history/history-times.js';

it('uses Desktop native millisecond message timestamps and never invents a reconnect timestamp', () => {
  const turn = { turnStartedAtMs: 1000, agentMessageCompletedAtMsById: { answer: 2400 } };

  expect(desktopItemTime(turn, { id: 'answer' })).toBe(2400);
  expect(desktopItemTime(turn, { id: 'user' })).toBe(1000);
  expect(desktopItemTime({}, {})).toBe(0);
});

it('loads native turn timestamps for item-list histories that omit time fields', async () => {
  const times = await historyTurnTimes(
    { request: async () => ({ data: [{ id: 'a', startedAt: 500 }], nextCursor: null }) },
    'thread',
    [],
    new Set(['a']),
  );

  expect(times.get('a')).toBe(500000);
});
