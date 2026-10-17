import { expect, it } from 'vitest';
import {
  targetSchema,
  sessionSchema,
  connectorSchema,
  clientCommandSchema,
} from '../packages/protocol/src/index.js';

const capabilities = {
  observe: true,
  history: true,
  prompt: true,
  interrupt: true,
  permission: true,
  terminalSnapshot: false,
};

it.each(['codex-cli', 'codex-desktop'])(
  'accepts %s with its own thread identity and app-server transport',
  (kind) => {
    const target = { kind, deviceId: 'mac', connectorId: 'codex', threadId: 'thread-one' };

    expect(targetSchema.safeParse(target).success).toBe(true);

    expect(
      connectorSchema.safeParse({
        connectorId: 'codex',
        kind,
        transport: 'app-server',
        sourceVersion: 'verified-local',
        capabilities,
        state: 'ready',
        reason: null,
      }).success,
    ).toBe(true);

    expect(
      clientCommandSchema.safeParse({
        commandId: 'command-one',
        target,
        sessionId: 'local-one',
        generation: 'lease-one',
        action: { type: 'prompt', text: 'Continue this exact Codex thread' },
      }).success,
    ).toBe(true);

    expect(targetSchema.safeParse({ ...target, claudeSessionId: 'another-provider' }).success).toBe(false);
    expect(targetSchema.safeParse({ ...target, threadId: '' }).success).toBe(false);
    expect(targetSchema.safeParse({ ...target, ownerId: 'another-owner' }).success).toBe(false);
  },
);

it.each(['codex-cli', 'codex-desktop'])('rejects Claude identity on a %s session', (kind) => {
  const session = {
    id: 'local-one',
    target: { kind, deviceId: 'mac', connectorId: 'codex', threadId: 'thread-one' },
    claudeSessionId: null,
    generation: 'lease-one',
    status: 'idle',
    binding: 'verified',
    lastEventAt: Date.now(),
    capabilities,
    integrationState: 'ready',
    statusConfidence: 'observed',
  };

  expect(sessionSchema.safeParse(session).success).toBe(true);
  expect(sessionSchema.safeParse({ ...session, claudeSessionId: 'another-provider' }).success).toBe(false);
});
