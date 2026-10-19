import { expect, it } from 'vitest';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { AdapterRegistry, SourceAdapter } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { noCapabilities } from '@protocol';

it('records child hook lifecycle without marking the parent turn finished', () => {
  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  adapters.register(
    new SourceAdapter({
      connectorId: 'native',
      kind: 'claude-code-cli',
      transport: 'hooks',
      sourceVersion: 'test',
      capabilities: { ...noCapabilities, observe: true, history: true },
      state: 'ready',
      reason: null,
    }),
  );

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  try {
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'parent' }, 'native');
    monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'parent' }, 'native');

    monitor.ingestHook(
      { hook_event_name: 'SubagentStart', session_id: 'parent', agent_id: 'child', agent_type: 'reviewer' },
      'native',
    );

    expect(monitor.snapshot().sessions[0]?.subagents).toEqual([
      expect.objectContaining({ id: 'child', name: 'reviewer', status: 'running' }),
    ]);

    const events = monitor.ingestHook(
      { hook_event_name: 'SubagentStop', session_id: 'parent', agent_id: 'child' },
      'native',
    );

    expect(monitor.snapshot().sessions[0]?.subagents?.[0]).toMatchObject({
      name: 'reviewer',
      status: 'completed',
    });

    expect(monitor.snapshot().sessions[0]?.status).toBe('running');
    expect(events[0]?.type).not.toBe('turn_end');
    monitor.invalidate('native');
    expect(monitor.snapshot().sessions[0]?.subagents?.[0]?.status).toBe('completed');
  } finally {
    permissions.close();
    store.close();
  }
});

function harness() {
  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  adapters.register(
    new SourceAdapter({
      connectorId: 'native',
      kind: 'claude-code-cli',
      transport: 'hooks',
      sourceVersion: 'test',
      capabilities: { ...noCapabilities, observe: true, history: true },
      state: 'ready',
      reason: null,
    }),
  );

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  return {
    monitor,
    adapters,
    session: () => monitor.snapshot().sessions[0],
    close: () => {
      permissions.close();
      store.close();
    },
  };
}

it('keeps subagents when the same Claude session starts again after compact or resume', () => {
  const { monitor, session, close } = harness();

  try {
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'parent' }, 'native');

    monitor.ingestHook(
      { hook_event_name: 'SubagentStart', session_id: 'parent', agent_id: 'child', agent_type: 'reviewer' },
      'native',
    );

    for (const source of ['compact', 'resume']) {
      monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'parent', source }, 'native');
      expect(session()?.subagents).toEqual([expect.objectContaining({ id: 'child', name: 'reviewer' })]);
    }
  } finally {
    close();
  }
});

it('starts a new Claude session in the same cmux surface without the previous subagents', () => {
  const { monitor, session, adapters, close } = harness();

  const target = {
    kind: 'cmux',
    deviceId: 'device',
    connectorId: 'wrapper',
    windowId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    surfaceId: '33333333-3333-4333-8333-333333333333',
  } as const;

  adapters.register(
    new SourceAdapter({
      connectorId: 'wrapper',
      kind: 'cmux',
      transport: 'cmux',
      sourceVersion: 'test',
      capabilities: { ...noCapabilities, observe: true, history: true },
      state: 'ready',
      reason: null,
    }),
  );

  try {
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'first' }, 'wrapper', target);

    monitor.ingestHook(
      { hook_event_name: 'SubagentStart', session_id: 'first', agent_id: 'child', agent_type: 'reviewer' },
      'wrapper',
      target,
    );

    expect(session()?.subagents).toHaveLength(1);

    monitor.ingestHook(
      { hook_event_name: 'SessionStart', session_id: 'second', source: 'clear' },
      'wrapper',
      target,
    );

    expect(monitor.snapshot().sessions).toHaveLength(1);
    expect(session()?.claudeSessionId).toBe('second');
    expect(session()?.subagents ?? []).toEqual([]);
  } finally {
    close();
  }
});
