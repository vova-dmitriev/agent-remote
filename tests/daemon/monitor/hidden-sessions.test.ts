import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventType, MAX_DEVICE_SESSIONS, MessageRole } from '@protocol';
import { AdapterRegistry, SourceAdapter } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { LocalStore } from '@daemon/monitor/store.js';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});

function open(path: string) {
  const store = new LocalStore(path, 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  adapters.register(
    new SourceAdapter({
      connectorId: 'native',
      kind: 'claude-code-cli',
      transport: 'hooks',
      sourceVersion: 'test',
      state: 'ready',
      reason: null,
      capabilities: {
        observe: true,
        history: true,
        prompt: false,
        interrupt: false,
        permission: true,
        terminalSnapshot: false,
      },
    }),
  );

  cleanups.push(() => {
    permissions.close();
    store.close();
  });

  return { store, monitor: new Monitor({ deviceId: 'device', store, adapters, permissions }) };
}

function statePath() {
  const directory = mkdtempSync(join(tmpdir(), 'hidden-sessions-'));

  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

  return join(directory, 'state.sqlite');
}

it('keeps a hidden session out of the lists across restarts until its next message', () => {
  const path = statePath(),
    first = open(path);

  first.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'synthetic' }, 'native');
  const id = first.monitor.findClaude('native', 'synthetic')!.id;

  expect(first.monitor.hide(id, 1_000)).toBe(true);
  expect(first.monitor.snapshot().sessions).toEqual([]);
  first.store.close();

  const second = open(path);

  expect(second.monitor.snapshot().sessions).toEqual([]);

  let snapshots = 0;

  second.monitor.on('snapshot', () => snapshots++);

  second.monitor.publish(id, EventType.Message, {
    id: 'older',
    role: MessageRole.User,
    text: 'Synthetic',
    occurredAt: 500,
  });

  expect(second.monitor.snapshot().sessions).toEqual([]);

  second.monitor.publish(id, EventType.Message, {
    id: 'newer',
    role: MessageRole.User,
    text: 'Synthetic',
    occurredAt: 2_000,
  });

  expect(snapshots).toBe(1);
  expect(second.monitor.snapshot().sessions.map((session) => session.id)).toEqual([id]);
});

it('keeps session creation available when the bounded snapshot is full', () => {
  const { monitor } = open(':memory:');

  for (let index = 0; index < MAX_DEVICE_SESSIONS; index++) {
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'synthetic-' + index }, 'native');
  }

  expect(monitor.canCreateSession()).toBe(true);

  monitor.hide(monitor.findClaude('native', 'synthetic-0')!.id);

  expect(monitor.canCreateSession()).toBe(true);

  expect(() =>
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'fresh' }, 'native'),
  ).not.toThrow();

  expect(monitor.snapshot().sessions).toHaveLength(MAX_DEVICE_SESSIONS);
});
