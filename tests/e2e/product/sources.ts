import type { Session, Target, ConnectorDescriptor } from '@protocol';
import { publishSnapshot } from './device.js';

export const sourceCases = [
  {
    name: 'native hooks',
    kind: 'claude-code-cli',
    transport: 'hooks',
    writable: false,
    terminal: false,
    permission: true,
  },
  {
    name: 'managed PTY',
    kind: 'claude-code-cli',
    transport: 'pty',
    writable: true,
    terminal: true,
    permission: true,
  },
  { name: 'cmux', kind: 'cmux', transport: 'cmux', writable: true, terminal: true, permission: true },
  {
    name: 'Desktop Code',
    kind: 'claude-code-desktop',
    transport: 'accessibility',
    writable: false,
    terminal: false,
    permission: false,
  },
  {
    name: 'Desktop Chat',
    kind: 'claude-desktop-chat',
    transport: 'accessibility',
    writable: false,
    terminal: false,
    permission: false,
  },
  {
    name: 'Codex CLI',
    kind: 'codex-cli',
    transport: 'app-server',
    writable: true,
    terminal: false,
    permission: true,
  },
  {
    name: 'Codex desktop',
    kind: 'codex-desktop',
    transport: 'app-server',
    writable: false,
    terminal: false,
    permission: false,
  },
] as const;

function sourceTarget(kind: Target['kind'], deviceId: string): Target {
  const base = { deviceId, connectorId: 'matrix-source' };

  if (kind === 'cmux')
    return {
      ...base,
      kind,
      windowId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      surfaceId: '00000000-0000-4000-8000-000000000003',
    };

  if (kind === 'claude-desktop-chat') return { ...base, kind, chatBindingId: 'synthetic-chat' };
  if (kind === 'codex-cli' || kind === 'codex-desktop')
    return { ...base, kind, threadId: 'synthetic-thread' };

  return { ...base, kind, claudeSessionId: 'synthetic-claude' };
}

export async function installSource(source: (typeof sourceCases)[number], override: Partial<Session> = {}) {
  await publishSnapshot((snapshot) => {
    const base = snapshot.sessions[0]!;

    const session: Session = {
      ...base,
      id: 'matrix-session',
      target: sourceTarget(source.kind, base.target.deviceId),
      claudeSessionId:
        source.kind.startsWith('codex') || source.kind === 'claude-desktop-chat' ? null : 'synthetic-claude',
      capabilities: {
        observe: true,
        history: true,
        prompt: source.writable,
        interrupt: source.writable,
        permission: source.permission,
        terminalSnapshot: source.terminal,
      },
      ...override,
    };

    snapshot.sessions = [session];

    snapshot.permissions = source.permission
      ? [
          {
            requestId: 'matrix-permission',
            sessionId: session.id,
            generation: session.generation,
            toolName: 'SyntheticTool',
            input: { synthetic: true },
            expiresAt: Date.now() + 120000,
          },
        ]
      : [];

    snapshot.terminal = source.terminal
      ? {
          sessionId: session.id,
          generation: session.generation,
          text: 'Synthetic terminal',
          capturedAt: Date.now(),
        }
      : null;
  }, [] satisfies ConnectorDescriptor[]);
}
