import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { Dispatcher } from '@daemon/commands/dispatcher.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { SourceAdapter, AdapterRegistry } from '@daemon/adapters/registry.js';
import type { Command } from '@protocol';

const cleanups: Array<() => void> = [];

afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-daemon-')),
    store = new LocalStore(join(dir, 'state.sqlite'), 'device');

  cleanups.push(
    () => rmSync(dir, { recursive: true, force: true }),
    () => store.close(),
  );

  const adapters = new AdapterRegistry('device');
  const broker = new PermissionBroker();

  cleanups.push(() => broker.close());

  const adapter = new SourceAdapter({
    connectorId: 'native',
    kind: 'claude-code-cli',
    transport: 'hooks',
    sourceVersion: 'test',
    capabilities: {
      observe: true,
      history: true,
      prompt: false,
      interrupt: false,
      permission: true,
      terminalSnapshot: false,
    },
    state: 'ready',
    reason: null,
  });

  adapters.register(adapter);
  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions: broker });

  return { dir, store, adapters, broker, adapter, monitor };
}

describe('daemon monitor and durable command dispatch', () => {
  it('publishes native restart ambiguity separately from missing proof without granting input', () => {
    const { monitor } = fixture();

    monitor.ingestHook({ hook_event_name: 'Stop', session_id: 'duplicate-native' }, 'native');
    const source = monitor.findClaude('native', 'duplicate-native')!;
    let snapshots = 0;

    monitor.on('snapshot', () => snapshots++);
    monitor.setNativeRestartState(source.id, source.generation, 'missing');
    monitor.setNativeRestartState(source.id, source.generation, 'ambiguous');

    expect(monitor.session(source.id)).toMatchObject({
      nativeRestartState: 'ambiguous',
      capabilities: { restartSession: false, prompt: false },
      binding: 'unverified',
    });

    expect(snapshots).toBe(2);

    monitor.setNativeRestartState(source.id, 'stale-generation', 'available');
    expect(source.nativeRestartState).toBe('ambiguous');
    monitor.setNativeRestartState(source.id, source.generation, 'available');
    expect(source.capabilities.restartSession).toBe(true);
    expect(source.capabilities.prompt).toBe(false);
    monitor.setNativeRestartState(source.id, source.generation, 'available');
    expect(snapshots).toBe(3);
  });

  it('publishes title-only snapshots for the exact session and preserves metadata on resume', () => {
    const { monitor } = fixture();

    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'title-source' }, 'native');
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'other-source' }, 'native');
    const session = monitor.findClaude('native', 'title-source')!;
    let snapshots = 0;

    monitor.on('snapshot', () => snapshots++);
    expect(monitor.setSessionTitle(session.id, '  Original title  ')).toBe(true);

    expect(monitor.snapshot().sessions.find((entry) => entry.id === session.id)?.title).toBe(
      'Original title',
    );

    expect(monitor.findClaude('native', 'other-source')?.title).toBeUndefined();
    expect(monitor.setSessionTitle('foreign-session', 'Wrong target')).toBe(false);
    expect(monitor.setSessionTitle(session.id, 'Original title')).toBe(false);
    expect(monitor.setSessionTitle(session.id, 'x'.repeat(513))).toBe(false);
    expect(snapshots).toBe(1);

    monitor.ingestHook(
      { hook_event_name: 'SessionStart', session_id: 'title-source', source: 'resume' },
      'native',
    );

    expect(monitor.findClaude('native', 'title-source')?.title).toBe('Original title');
    expect(monitor.setSessionTitle(session.id, undefined)).toBe(true);
    expect(monitor.findClaude('native', 'title-source')?.title).toBeUndefined();
  });

  it('keeps native CLI read-only, maps lifecycle hooks, and changes generation only for a new start', () => {
    const { monitor, adapter } = fixture();

    monitor.ingestHook(
      { hook_event_name: 'SessionStart', session_id: 'claude-s', source: 'startup' },
      'native',
    );

    const first = monitor.snapshot().sessions[0]!;

    expect(first.capabilities.prompt).toBe(false);
    expect(first.status).toBe('unknown');
    monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'claude-s' }, 'native');
    expect(monitor.snapshot().sessions[0]?.status).toBe('running');
    monitor.ingestHook({ hook_event_name: 'Stop', session_id: 'claude-s' }, 'native');
    expect(monitor.snapshot().sessions[0]?.status).toBe('idle');

    monitor.ingestHook(
      { hook_event_name: 'SessionStart', session_id: 'claude-s', source: 'resume' },
      'native',
    );

    expect(monitor.snapshot().sessions[0]?.generation).not.toBe(first.generation);
    expect(adapter.descriptor().transport).toBe('hooks');
  });

  it('fences foreign connectors and never dispatches twice even after restart with unfinished work', async () => {
    const f = fixture();
    let sends = 0;

    const adapter = new SourceAdapter(
      {
        connectorId: 'managed',
        kind: 'claude-code-cli',
        transport: 'pty',
        sourceVersion: 'fixture',
        capabilities: {
          observe: true,
          history: true,
          prompt: true,
          interrupt: true,
          permission: true,
          terminalSnapshot: false,
        },
        state: 'ready',
        reason: null,
      },
      {
        prompt: async () => {
          sends++;

          return { status: 'dispatched' };
        },
        interrupt: async () => ({ status: 'dispatched' }),
      },
    );

    f.adapters.register(adapter);
    f.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 's' }, 'managed');
    f.monitor.ingestHook({ hook_event_name: 'Stop', session_id: 's' }, 'managed');
    const session = f.monitor.snapshot().sessions.find((s) => s.target.connectorId === 'managed')!;

    const dispatcher = new Dispatcher({
      deviceId: 'device',
      store: f.store,
      monitor: f.monitor,
      adapters: f.adapters,
      permissions: f.broker,
      inputEnabled: true,
      permissionsEnabled: true,
    });

    const command: Command = {
      version: 1,
      commandId: 'one',
      target: session.target,
      sessionId: session.id,
      generation: session.generation,
      expiresAt: Date.now() + 15000,
      action: { type: 'prompt', text: 'hello' },
    };

    expect((await dispatcher.dispatch(command)).status).toBe('dispatched');
    expect((await dispatcher.dispatch(command)).status).toBe('dispatched');
    expect(sends).toBe(1);

    expect(
      (await dispatcher.dispatch({ ...command, action: { type: 'prompt', text: 'changed' } })).code,
    ).toBe('COMMAND_ID_REUSED');

    expect((await dispatcher.dispatch({ ...command, commandId: 'two', generation: 'old' })).code).toBe(
      'STALE_SESSION',
    );

    expect(sends).toBe(1);
    expect(() => f.adapters.resolve({ ...session.target, connectorId: 'foreign' })).toThrow('NOT_FOUND');
    const crash = { ...command, commandId: 'crash' };

    expect(f.store.begin(crash)).toBe('new');
    f.store.recoverCommands();
    expect((await dispatcher.dispatch(crash)).status).toBe('unknown');
    expect(sends).toBe(1);
  });

  it('returns explicit resync for discarded events and persists the cursor', () => {
    const { store } = fixture();

    for (let i = 0; i < 4; i++) {
      store.append({ sessionId: null, type: 'diagnostic', payload: {}, occurredAt: 1000 + i });
    }

    const cursor = store.cursor();

    store.prune(Date.now());
    expect(store.replay({ streamId: cursor.streamId, seq: 0 })).toBe('resync_required');
    expect(store.cursor()).toEqual(cursor);
  });
});

it('keeps current hook models until transcript metadata advances and clears removed transcript models', () => {
  const { monitor } = fixture();

  monitor.ingestHook(
    { hook_event_name: 'SessionStart', session_id: 'model-source', model: 'claude-hook-current' },
    'native',
  );

  const session = monitor.findClaude('native', 'model-source')!;

  monitor.setSessionModel(session.id, 'claude-previous-turn', 'transcript');
  expect(session.model).toBe('claude-hook-current');
  monitor.setSessionModel(session.id, 'claude-transcript-next', 'transcript');
  expect(session.model).toBe('claude-transcript-next');

  monitor.ingestHook(
    { hook_event_name: 'Stop', session_id: 'model-source', model: 'claude-hook-next' },
    'native',
  );

  monitor.setSessionModel(session.id, 'claude-transcript-next', 'transcript');
  expect(session.model).toBe('claude-hook-next');
  monitor.setSessionModel(session.id, 'claude-actual', 'transcript');
  monitor.setSessionModel(session.id, undefined, 'transcript');
  expect(session.model).toBeUndefined();
  expect(monitor.snapshot().sessions[0]?.model).toBeUndefined();
});

it('fences stale transcript model reads after a same-generation native hook model update', () => {
  const { monitor } = fixture();

  monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'async-model-source' }, 'native');
  const session = monitor.findClaude('native', 'async-model-source')!;

  monitor.setSessionModel(session.id, 'claude-before', 'transcript', 0);
  const generation = session.generation;

  monitor.ingestHook(
    { hook_event_name: 'Stop', session_id: 'async-model-source', model: 'claude-new-native' },
    'native',
  );

  monitor.setSessionModel(session.id, 'claude-stale-read', 'transcript', 0);
  expect(session.model).toBe('claude-new-native');
  expect(session.generation).toBe(generation);
  monitor.setSessionModel(session.id, 'claude-stale-read', 'transcript');
  expect(session.model).toBe('claude-new-native');
  monitor.setSessionModel(session.id, 'claude-fresh-read', 'transcript');
  expect(session.model).toBe('claude-fresh-read');
});
