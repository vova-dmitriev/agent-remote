import type { Session, AppSnapshot } from '@protocol';
import { codexFixtures } from './codex-fixtures.js';

export function sessionSnapshot(deviceId: string): AppSnapshot {
  const base: Session = {
    id: 'terminal-session',
    target: {
      kind: 'claude-code-cli',
      deviceId,
      connectorId: 'pty',
      claudeSessionId: 'cli-original-context',
    },
    claudeSessionId: 'cli-original-context',
    generation: 'g',
    status: 'idle',
    binding: 'verified',
    lastEventAt: Date.now(),
    capabilities: {
      observe: true,
      history: true,
      prompt: true,
      interrupt: true,
      permission: true,
      terminalSnapshot: true,
    },
    integrationState: 'ready',
    statusConfidence: 'observed',
  };

  const chat: Session = {
    ...base,
    id: 'chat-session',
    target: { kind: 'claude-desktop-chat', deviceId, connectorId: 'chat', chatBindingId: 'b' },
    claudeSessionId: null,
    capabilities: { ...base.capabilities, permission: false, terminalSnapshot: false },
    statusConfidence: 'inferred',
  };

  const codex = codexFixtures(base);

  return {
    sessions: [
      { ...base, title: 'Synthetic sprint fixes', model: 'claude-sonnet-4-6' },
      chat,
      ...codex.sessions,
    ],
    deviceStatus: 'online',
    cursor: { streamId: 'e2e', seq: 0 },
    permissions: [
      ...codex.permissions,
      {
        requestId: 'permission-one',
        sessionId: base.id,
        generation: 'g',
        toolName: 'Bash',
        input: { command: 'pwd' },
        expiresAt: Date.now() + 120000,
      },
    ],
    terminal: {
      sessionId: base.id,
      generation: 'g',
      text: '<script>alert(1)</script>',
      capturedAt: Date.now(),
    },
  };
}
