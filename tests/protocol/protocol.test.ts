import { describe, it, expect } from 'vitest';
import { targetSchema, commandSchema, appFrameSchema, sessionSchema } from '@protocol';

const target = { kind: 'claude-code-cli', deviceId: 'd', connectorId: 'c', claudeSessionId: 's' };

const command = {
  version: 1,
  commandId: 'a',
  target,
  sessionId: 's',
  generation: 'g',
  expiresAt: Date.now() + 15000,
  action: { type: 'prompt', text: 'hello' },
};

describe('wire protocol', () => {
  it('separates sources and rejects authority fields and focused cmux targets', () => {
    expect(targetSchema.parse(target)).toEqual(target);
    expect(targetSchema.safeParse({ ...target, ownerId: 'another' }).success).toBe(false);

    expect(
      targetSchema.safeParse({
        kind: 'cmux',
        deviceId: 'd',
        connectorId: 'c',
        windowId: 'current',
        workspaceId: 'focused',
        surfaceId: 'active',
      }).success,
    ).toBe(false);
  });

  it('enforces version and validates prompts in UTF-8 bytes', () => {
    expect(commandSchema.parse(command)).toEqual(command);
    expect(commandSchema.safeParse({ ...command, version: 2 }).success).toBe(false);

    expect(
      commandSchema.safeParse({ ...command, action: { type: 'prompt', text: '👋'.repeat(4097) } }).success,
    ).toBe(false);

    expect(commandSchema.safeParse({ ...command, action: { type: 'prompt', text: '\r' } }).success).toBe(
      false,
    );
  });

  it('does not allow a browser to stamp command expiry or impersonate an owner', () => {
    expect(appFrameSchema.safeParse({ type: 'command', command }).success).toBe(false);

    expect(
      appFrameSchema.safeParse({ type: 'subscribe', deviceId: 'd', sessionId: null, ownerId: 'b' }).success,
    ).toBe(false);
  });

  it('cannot advertise terminal or tool permissions for Desktop Chat', () => {
    const session = {
      id: 's',
      target: { kind: 'claude-desktop-chat', deviceId: 'd', connectorId: 'c', chatBindingId: 'b' },
      claudeSessionId: null,
      generation: 'g',
      status: 'idle',
      binding: 'verified',
      lastEventAt: Date.now(),
      capabilities: {
        observe: true,
        history: true,
        prompt: true,
        interrupt: false,
        permission: true,
        terminalSnapshot: false,
      },
      integrationState: 'ready',
      statusConfidence: 'inferred',
    };

    expect(sessionSchema.safeParse(session).success).toBe(false);
  });
});
