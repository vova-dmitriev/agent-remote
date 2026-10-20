import { expect, it } from 'vitest';
import { actionSchema, snapshotSchema } from '@protocol';

it('accepts structured question answers and explicit skip without converting them to prompts', () => {
  expect(
    actionSchema.safeParse({
      type: 'user_input',
      requestId: 'request',
      answers: { style: { answers: ['Dark'] } },
    }).success,
  ).toBe(true);

  expect(actionSchema.safeParse({ type: 'user_input', requestId: 'request', answers: {} }).success).toBe(
    true,
  );
});

it('carries pending questions in a backward-compatible snapshot', () => {
  const snapshot = {
    sessions: [],
    deviceStatus: 'online',
    cursor: { streamId: 'stream', seq: 0 },
    permissions: [],
    terminal: null,
  };

  expect(snapshotSchema.safeParse(snapshot).success).toBe(true);

  expect(
    snapshotSchema.safeParse({
      ...snapshot,
      userInputs: [
        {
          requestId: 'request',
          sessionId: 'session',
          generation: 'generation',
          turnId: 'turn',
          itemId: 'item',
          isBlocking: true,
          expiresAt: 100,
          questions: [
            {
              id: 'style',
              header: 'Style',
              question: 'Pick a style',
              isOther: true,
              isSecret: false,
              options: [{ label: 'Dark', description: 'Dark palette' }],
            },
          ],
        },
      ],
    }).success,
  ).toBe(true);
});

it('rejects oversized, malformed and prototype-key question responses', () => {
  for (const answers of [
    { style: { answers: ['x'.repeat(8193)] } },
    { style: { answers: [42] } },
    JSON.parse('{"__proto__":{"answers":["bad"]}}'),
  ]) {
    expect(actionSchema.safeParse({ type: 'user_input', requestId: 'request', answers }).success).toBe(false);
  }
});
