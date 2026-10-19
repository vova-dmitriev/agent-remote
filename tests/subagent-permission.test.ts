import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { noCapabilities } from '@protocol';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { AdapterRegistry, SourceAdapter } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { startHookServer } from '../apps/daemon/src/code/hooks/hook-server.js';
import { requestLocal } from '../apps/daemon/src/code/hooks/ipc.js';

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
});

function harness(store = new LocalStore(':memory:', 'device')) {
  const adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  adapters.register(
    new SourceAdapter({
      connectorId: 'native',
      kind: 'claude-code-cli',
      transport: 'hooks',
      sourceVersion: 'test',
      capabilities: { ...noCapabilities, observe: true, history: true, permission: true },
      state: 'ready',
      reason: null,
    }),
  );

  cleanup.push(() => permissions.close());
  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  return { monitor, adapters, permissions, store, session: () => monitor.snapshot().sessions[0] };
}

const child = { session_id: 'parent', agent_id: 'child', agent_type: 'reviewer' };

function idleParentWithChild(monitor: Monitor) {
  monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'parent' }, 'native');
  monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'parent' }, 'native');
  monitor.ingestHook({ hook_event_name: 'SubagentStart', ...child }, 'native');
  monitor.ingestHook({ hook_event_name: 'Stop', session_id: 'parent' }, 'native');
}

it('marks the subagent, not the parent, as waiting on its permission request until it works again', () => {
  const { monitor, store, session } = harness();

  cleanup.push(() => store.close());
  idleParentWithChild(monitor);
  const childStatus = () => session()?.subagents?.find((agent) => agent.id === 'child')?.status;

  const events = monitor.ingestHook(
    { hook_event_name: 'PermissionRequest', ...child, tool_name: 'Bash', tool_use_id: 'synthetic-tool' },
    'native',
  );

  expect(events.map((event) => event.type)).toEqual(['permission']);
  expect(session()?.status).toBe('idle');
  expect(childStatus()).toBe('waiting_input');

  for (const [hook_event_name, expected] of [
    ['PostToolUse', 'running'],
    ['PreToolUse', 'running'],
    ['SubagentStop', 'completed'],
  ] as const) {
    monitor.ingestHook(
      { hook_event_name, ...child, tool_name: 'Bash', tool_use_id: 'synthetic-tool' },
      'native',
    );

    expect(session()?.status).toBe('idle');
    expect(childStatus()).toBe(expected);
  }
});

it('lists an unseen subagent only once it starts a tool call', () => {
  const { monitor, store, session } = harness();

  cleanup.push(() => store.close());
  monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'parent' }, 'native');

  for (const hook_event_name of ['PostToolUse', 'Notification', 'Stop', 'PermissionRequest']) {
    monitor.ingestHook({ hook_event_name, session_id: 'parent', agent_id: 'internal' }, 'native');
  }

  expect(session()?.subagents ?? []).toEqual([]);
  monitor.ingestHook({ hook_event_name: 'PreToolUse', session_id: 'parent', agent_id: 'internal' }, 'native');
  expect(session()?.subagents).toEqual([expect.objectContaining({ id: 'internal', status: 'running' })]);
});

it('marks a restored native session observed once a live hook arrives', () => {
  const store = new LocalStore(':memory:', 'device');

  cleanup.push(() => store.close());
  harness(store).monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'parent' }, 'native');
  const restored = harness(store);

  expect(restored.session()).toMatchObject({
    statusConfidence: 'inferred',
    integrationState: 'needs_restart',
  });

  restored.monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'parent' }, 'native');
  expect(restored.session()?.statusConfidence).toBe('observed');
});

it('keeps the permission card on the parent and releases the subagent after a remote answer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subagent-permission-'));

  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const { monitor, adapters, permissions, store, session } = harness();

  cleanup.push(() => store.close());
  const path = join(directory, 'hook.sock');

  const server = await startHookServer({
    path,
    token: 'local',
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  cleanup.push(() => server.close());

  const hook = (payload: Record<string, unknown>) =>
    requestLocal(path, { type: 'hook', token: 'local', payload });

  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'Stop']) {
    await hook({
      hook_event_name,
      ...(hook_event_name === 'SubagentStart' ? child : { session_id: 'parent' }),
    });
  }

  const childStatus = () => session()?.subagents?.find((agent) => agent.id === 'child')?.status;

  const permission = () =>
    hook({ hook_event_name: 'PermissionRequest', ...child, tool_name: 'Bash', tool_input: {} });

  const allowed = permission();

  await expect.poll(() => monitor.snapshot().permissions.length).toBe(1);
  const pending = monitor.snapshot().permissions[0]!;

  expect(pending).toMatchObject({ sessionId: session()!.id, toolName: 'Bash' });
  expect(session()?.capabilities.permission).toBe(true);
  expect(session()?.status).toBe('idle');
  expect(childStatus()).toBe('waiting_input');
  expect(permissions.resolve(pending.requestId, pending.generation, 'allow')).toBe(true);
  await allowed;
  expect(childStatus()).toBe('running');

  const fallback = permission();

  await expect.poll(() => monitor.snapshot().permissions.length).toBe(1);
  permissions.cancelSession(session()!.id, session()!.generation);
  await fallback;
  expect(childStatus()).toBe('waiting_input');
  expect(session()?.status).toBe('idle');
});
