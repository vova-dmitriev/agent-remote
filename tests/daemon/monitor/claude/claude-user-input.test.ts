import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CommandActionType,
  CommandStatus,
  ConnectorId,
  ConnectorTransport,
  IntegrationState,
  SessionStatus,
  TargetKind,
} from '@protocol';
import { AdapterRegistry, SourceAdapter } from '@daemon/adapters/registry.js';
import { Dispatcher } from '@daemon/commands/dispatcher.js';
import { startHookServer } from '@daemon/code/hooks/hook-server.js';
import { requestLocal } from '@daemon/code/hooks/ipc.js';
import { IpcMessageType } from '@daemon/domain/ipc.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { UserInputBroker } from '@daemon/commands/user-input-broker.js';

const questionHook = (sessionId: string, callId: string) => ({
  hook_event_name: 'PreToolUse',
  session_id: sessionId,
  tool_use_id: callId,
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      {
        question: 'Which tools?',
        header: 'Tools',
        options: [
          { label: 'Read', description: 'Inspect files' },
          { label: 'Write', description: 'Edit files' },
        ],
        multiSelect: true,
      },
    ],
  },
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'claude-user-input-')),
    path = join(root, 'hooks.sock'),
    token = 'synthetic-hook-token',
    store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker(),
    userInputs = new UserInputBroker();

  adapters.register(
    new SourceAdapter(
      {
        connectorId: ConnectorId.Native,
        kind: TargetKind.ClaudeCodeCli,
        transport: ConnectorTransport.Hooks,
        sourceVersion: 'test',
        capabilities: {
          observe: true,
          history: true,
          prompt: false,
          interrupt: true,
          permission: false,
          userInput: true,
          terminalSnapshot: false,
        },
        state: IntegrationState.Ready,
        reason: null,
      },
      { interrupt: async () => ({ status: 'dispatched' }) },
    ),
  );

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions, userInputs });

  const dispatcher = new Dispatcher({
    deviceId: 'device',
    store,
    monitor,
    adapters,
    permissions,
    userInputs,
    inputEnabled: true,
    permissionsEnabled: false,
  });

  const server = await startHookServer({
    path,
    token,
    monitor,
    adapters,
    permissions,
    userInputs,
    inputEnabled: true,
    permissionsEnabled: false,
  });

  const hook = (payload: unknown) => requestLocal(path, { type: IpcMessageType.Hook, token, payload });

  await hook({ hook_event_name: 'SessionStart', session_id: 'claude-session' });

  return {
    adapters,
    hook,
    monitor,
    dispatcher,
    path,
    permissions,
    root,
    server,
    store,
    token,
    userInputs,
  };
}

it('forwards structured Claude questions and returns validated multi-select answers through the native hook', async () => {
  const f = await fixture();

  try {
    const pendingHook = requestLocal(
      f.path,
      { type: IpcMessageType.Hook, token: f.token, payload: questionHook('claude-session', 'tool-1') },
      100,
      undefined,
      5000,
    );

    const pending = await vi.waitFor(() => {
      const value = f.userInputs.pending()[0];

      expect(value).toBeDefined();

      return value!;
    });

    expect(pending.questions).toMatchObject([
      {
        question: 'Which tools?',
        multiSelect: true,
        options: [{ label: 'Read' }, { label: 'Write' }],
      },
    ]);

    const session = f.monitor.snapshot().sessions[0]!;

    expect(session.status).toBe('waiting_input');

    await f.userInputs.submit(pending.requestId, pending.generation, {
      [pending.questions[0]!.id]: { answers: ['Read', 'Write'] },
    });

    expect(f.monitor.session(session.id)?.status).toBe('running');

    await expect(pendingHook).resolves.toMatchObject({
      type: IpcMessageType.HookResult,
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { answers: { 'Which tools?': 'Read, Write' } },
        },
      },
    });

    expect(f.userInputs.pending()).toEqual([]);
  } finally {
    await f.server.close();
    f.permissions.close();
    f.userInputs.close();
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it('clears a held question on dispatched interrupt without faking idle while idle_prompt is late', async () => {
  const f = await fixture();

  try {
    const pendingHook = requestLocal(
      f.path,
      { type: IpcMessageType.Hook, token: f.token, payload: questionHook('claude-session', 'tool-2') },
      100,
      undefined,
      5000,
    );

    await vi.waitFor(() => expect(f.userInputs.pending()).toHaveLength(1));
    const session = f.monitor.snapshot().sessions[0]!;

    await expect(
      f.dispatcher.dispatch({
        version: 1,
        commandId: 'interrupt-tool-2',
        target: session.target,
        sessionId: session.id,
        generation: session.generation,
        expiresAt: Date.now() + 5000,
        action: { type: CommandActionType.Escape },
      }),
    ).resolves.toMatchObject({
      status: CommandStatus.Dispatched,
    });

    await expect(pendingHook).resolves.toMatchObject({
      type: IpcMessageType.HookResult,
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
        },
      },
    });

    expect(f.userInputs.pending()).toEqual([]);
    expect(f.monitor.session(session.id)?.status).toBe(SessionStatus.Running);

    await f.hook({
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
      session_id: 'claude-session',
    });

    expect(f.monitor.session(session.id)?.status).toBe(SessionStatus.Idle);
  } finally {
    await f.server.close();
    f.permissions.close();
    f.userInputs.close();
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it('denies a late answer after the source has left its pending-input state', async () => {
  const f = await fixture();

  try {
    const pendingHook = requestLocal(
      f.path,
      { type: IpcMessageType.Hook, token: f.token, payload: questionHook('claude-session', 'tool-3') },
      100,
      undefined,
      5000,
    );

    await vi.waitFor(() => expect(f.userInputs.pending()).toHaveLength(1));
    const session = f.monitor.snapshot().sessions[0]!;
    const pending = f.userInputs.pending()[0]!;

    f.monitor.session(session.id)!.status = SessionStatus.Idle;

    await f.userInputs.submit(pending.requestId, pending.generation, {
      [pending.questions[0]!.id]: { answers: ['Read'] },
    });

    await expect(pendingHook).resolves.toMatchObject({
      type: IpcMessageType.HookResult,
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
        },
      },
    });

    expect(f.monitor.session(session.id)?.status).toBe(SessionStatus.Idle);
  } finally {
    await f.server.close();
    f.permissions.close();
    f.userInputs.close();
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
