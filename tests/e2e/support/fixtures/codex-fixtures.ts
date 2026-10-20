import type { Session, PendingPermission } from '@protocol';

export function codexFixtures(base: Session) {
  const sessions: Session[] = (['codex-cli', 'codex-desktop'] as const).map((kind) => ({
    ...base,
    id: kind + '-session',
    model: kind === 'codex-cli' ? 'gpt-synthetic-cli' : 'gpt-synthetic-desktop',
    target: { kind, deviceId: base.target.deviceId, connectorId: kind, threadId: kind + '-thread' },
    claudeSessionId: null,
    capabilities: { ...base.capabilities, terminalSnapshot: false },
  }));

  const permissions: PendingPermission[] = sessions.map((session) => ({
    requestId: session.id + '-permission',
    sessionId: session.id,
    generation: session.generation,
    toolName: 'Codex command',
    input: { command: 'pwd' },
    expiresAt: Date.now() + 120000,
  }));

  return { sessions, permissions };
}
