import { expect, it } from 'vitest';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry, SourceAdapter } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { noCapabilities, SessionStatus } from '@protocol';

const wrapper = (connectorId: string) =>
  new SourceAdapter({
    connectorId,
    kind: 'claude-code-cli',
    transport: 'pty',
    sourceVersion: 'synthetic',
    state: 'ready',
    reason: null,
    capabilities: { ...noCapabilities, observe: true, history: true, prompt: true },
  });

const start = (session_id: string) => ({
  hook_event_name: 'SessionStart',
  session_id,
  cwd: '/synthetic',
  transcript_path: '/synthetic/source.jsonl',
});

it('a restart of the conversation closes its earlier session, which stays closed after a daemon restart', () => {
  const store = new LocalStore(':memory:', 'device'),
    permissions = new PermissionBroker(),
    adapters = new AdapterRegistry('device');

  adapters.register(wrapper('old-wrapper'));
  adapters.register(wrapper('new-wrapper'));
  adapters.register(wrapper('other-wrapper'));

  try {
    const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

    monitor.ingestHook(start('conversation'), 'old-wrapper');
    monitor.ingestHook(start('another'), 'other-wrapper');
    const old = monitor.findClaude('old-wrapper', 'conversation')!;

    monitor.setPinned(old.id, true);
    monitor.ingestHook(start('conversation'), 'new-wrapper');
    const restarted = monitor.findClaude('new-wrapper', 'conversation')!;

    expect(monitor.session(old.id)?.status).toBe(SessionStatus.Ended);

    expect(
      monitor
        .snapshot()
        .sessions.map((session) => session.id)
        .sort(),
    ).toEqual([restarted.id, monitor.findClaude('other-wrapper', 'another')!.id].sort());

    expect(monitor.snapshot().sessions.find((session) => session.id === restarted.id)?.pinned).toBe(true);

    // The old wrapper registers again after a daemon restart: its closed record is not brought back.
    const next = new Monitor({ deviceId: 'device', store, adapters, permissions });

    expect(next.managedRegistration('old-wrapper')).toBeUndefined();
    expect(next.managedRegistration('new-wrapper')?.session.id).toBe(restarted.id);
  } finally {
    permissions.close();
    store.close();
  }
});
