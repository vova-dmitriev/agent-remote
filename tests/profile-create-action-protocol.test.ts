import { expect, it } from 'vitest';
import { commandSchema } from '../packages/protocol/src/index.js';

it('accepts an optional versioned profile selection on session creation', () => {
  const parsed = commandSchema.safeParse({
    version: 1,
    commandId: 'command-a',
    target: {
      kind: 'claude-code-cli',
      deviceId: 'device-a',
      connectorId: 'connector-a',
      claudeSessionId: 'source-session',
    },
    sessionId: 'source-session',
    generation: 'generation-a',
    expiresAt: Date.now() + 10_000,
    action: {
      type: 'create_session',
      provider: 'codex',
      cwd: '/synthetic/project',
      execution: {
        selection: {
          profileId: '00000000-0000-4000-8000-000000000001',
          provider: 'codex',
          model: 'synthetic-model',
          effort: 'high',
        },
        expectedVersion: 1,
      },
    },
  });

  expect(parsed.success).toBe(true);
});

it('continues to accept legacy creation and rejects mismatched or unknown profile envelope fields', () => {
  const action = {
    type: 'create_session',
    provider: 'codex',
    cwd: '/synthetic/project',
  };

  const base = {
    version: 1,
    commandId: 'command-a',
    target: {
      kind: 'claude-code-cli',
      deviceId: 'device-a',
      connectorId: 'connector-a',
      claudeSessionId: 'source-session',
    },
    sessionId: 'source-session',
    generation: 'generation-a',
    expiresAt: Date.now() + 10_000,
  };

  expect(commandSchema.safeParse({ ...base, action }).success).toBe(true);

  expect(
    commandSchema.safeParse({
      ...base,
      action: {
        ...action,
        execution: {
          selection: {
            profileId: '00000000-0000-4000-8000-000000000001',
            provider: 'claude',
            model: 'synthetic-model',
          },
          expectedVersion: 1,
        },
      },
    }).success,
  ).toBe(false);

  expect(
    commandSchema.safeParse({ ...base, action: { ...action, execution: { arbitrary: 'value' } } }).success,
  ).toBe(false);
});
