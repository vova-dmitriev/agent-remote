import { expect, it } from 'vitest';
import { desktopTurns, applyDesktopPatches } from '../apps/daemon/src/codex/desktop-state.js';

it('merges canonical turns and live overlays by exact turn identity', () => {
  const state = {
    turnHistory: {
      kind: 'canonical',
      history: {
        islands: [{ entries: [{ value: 'key' }] }],
        entitiesByKey: {
          key: {
            turnId: 'one',
            status: 'inProgress',
            params: { input: [{ type: 'text', text: 'Synthetic prompt' }] },
            items: [{ id: 'm', type: 'agentMessage', text: 'Old' }],
          },
        },
      },
    },
    turns: [
      {
        turnId: 'one',
        status: 'completed',
        params: { input: [{ type: 'text', text: 'Synthetic prompt' }] },
        items: [{ id: 'm', type: 'agentMessage', text: 'New' }],
      },
    ],
  };

  expect(desktopTurns(state)).toEqual([
    expect.objectContaining({
      id: 'one',
      status: 'completed',
      items: [expect.objectContaining({ type: 'userMessage' }), expect.objectContaining({ text: 'New' })],
    }),
  ]);
});

it('applies bounded Immer array patches and rejects prototype traversal', () => {
  const state = { turns: [{ items: [{ text: 'Old' }] }] };

  const next = applyDesktopPatches(state, [
    { op: 'replace', path: ['turns', 0, 'items', 0, 'text'], value: 'New' },
  ]);

  expect(next.turns).toEqual([{ items: [{ text: 'New' }] }]);

  expect(() =>
    applyDesktopPatches(state, [{ op: 'add', path: ['__proto__', 'polluted'], value: true }]),
  ).toThrow('CODEX_PROTOCOL_ERROR');

  expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
});
