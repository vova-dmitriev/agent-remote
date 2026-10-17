import { expect, it } from 'vitest';
import { desktopTurns } from '../apps/daemon/src/codex/desktop-state.js';
import { itemMessage, object } from '../apps/daemon/src/codex/events.js';

const input = [{ type: 'text', text: 'Synthetic repeated prompt' }];

it('upserts the preliminary Desktop prompt when its canonical user item arrives', () => {
  const messages = new Map<string, unknown>();

  const snapshots = [
    [],
    [{ id: 'native-primary', type: 'userMessage', content: input }],
    [
      { id: 'native-primary', type: 'userMessage', content: input },
      { id: 'answer', type: 'agentMessage', text: 'Once' },
    ],
  ];

  for (const items of snapshots) {
    for (const turn of desktopTurns({ turns: [{ turnId: 'one', params: { input }, items }] })) {
      for (const item of turn.items as unknown[]) {
        const message = itemMessage(item, String(turn.id));

        if (message) {
          messages.set(message.id, message);
        }
      }
    }
  }

  expect([...messages.values()]).toEqual([
    expect.objectContaining({ id: 'one:turn-input', role: 'user', text: 'Synthetic repeated prompt' }),
    expect.objectContaining({ id: 'one:answer', role: 'assistant', text: 'Once' }),
  ]);
});

it('preserves identical prompts from different turns and later steering inputs in the same turn', () => {
  const primary = { id: 'native-primary', type: 'userMessage', content: input };
  const steer = { id: 'native-steer', type: 'userMessage', content: input };

  const state = {
    turns: [
      { turnId: 'one', params: { input }, items: [primary, steer] },
      { turnId: 'two', params: { input }, items: [{ ...primary, id: 'native-next' }] },
    ],
  };

  const messages = desktopTurns(state).flatMap((turn) =>
    (turn.items as unknown[]).map((item) => itemMessage(item, String(turn.id))),
  );

  expect(messages.map((message) => message?.id)).toEqual([
    'one:turn-input',
    'one:native-steer',
    'two:turn-input',
  ]);

  expect(object(state.turns[0]?.items[0]).id).toBe('native-primary');
});

it('keeps the same primary identity in canonical history and leaves parameterless history unchanged', () => {
  const completed = {
    turnId: 'completed',
    status: 'completed',
    params: { input },
    items: [{ id: 'native-primary', type: 'userMessage', content: input }],
  };

  const legacy = {
    turnId: 'legacy',
    items: [{ id: 'legacy-primary', type: 'userMessage', content: input }],
  };

  const turns = desktopTurns({
    turnHistory: {
      history: {
        islands: [{ entries: [{ value: 'completed' }, { value: 'legacy' }] }],
        entitiesByKey: { completed, legacy },
      },
    },
  });

  expect(turns.map((turn) => itemMessage((turn.items as unknown[])[0], String(turn.id))?.id)).toEqual([
    'completed:turn-input',
    'legacy:legacy-primary',
  ]);
});
