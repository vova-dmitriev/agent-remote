import { afterEach, expect, it, vi } from 'vitest';
import {
  mergePosition,
  readPosition,
  subscribePositions,
  writePosition,
} from '@/shared/lib/reading-position/index.js';

afterEach(() => vi.unstubAllGlobals());

it('migrates an unchanged legacy browser bookmark into a timestamped server save', () => {
  const scope = 'legacy-device:session',
    position = { messageId: 'legacy-message', offset: 37 };

  const stored = new Map([['agent-remote:reading:v1', JSON.stringify([[scope, position]])]]);

  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });

  const saves: unknown[] = [];
  const unsubscribe = subscribePositions((_scope, value) => saves.push(value));

  try {
    expect(readPosition(scope)).toEqual(position);
    writePosition(scope, position);
    expect(readPosition(scope)?.updatedAt).toBeGreaterThan(0);
    expect(saves).toEqual([expect.objectContaining(position)]);
  } finally {
    unsubscribe();
  }
});

it('keeps a newer local reading line when a delayed remote bookmark arrives', () => {
  const scope = 'race-device:session';

  writePosition(scope, { messageId: 'latest', offset: 83 });
  const current = readPosition(scope)!;

  mergePosition(scope, { messageId: 'stale', offset: 0, updatedAt: current.updatedAt! - 1 });
  expect(readPosition(scope)).toEqual(current);
  expect(readPosition('another-device:session')).toBeUndefined();
});

it('hydrates server positions without echoing them as local saves and unsubscribes disposed transports', () => {
  const scope = 'hydrate-device:session';
  const saves: unknown[] = [];
  const unsubscribe = subscribePositions((_scope, value) => saves.push(value));

  mergePosition(scope, { messageId: 'remote', offset: 12, updatedAt: Date.now() });
  expect(saves).toEqual([]);
  writePosition(scope, { messageId: 'remote', offset: 83 });
  expect(saves).toHaveLength(1);
  unsubscribe();
  writePosition(scope, { messageId: 'remote', offset: 84 });
  expect(saves).toHaveLength(1);
});
