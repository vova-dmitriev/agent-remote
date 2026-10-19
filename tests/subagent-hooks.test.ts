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
