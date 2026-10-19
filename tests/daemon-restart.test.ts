import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { EventReplay } from '../apps/daemon/src/monitor/replay.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { AdapterRegistry, SourceAdapter } from '../apps/daemon/src/adapters/registry.js';
import type { EventEnvelope } from '@protocol';

const cleanups: Array<() => void> = [];

afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'daemon-restart-'));

  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  let store: LocalStore;

  const open = (deviceId = 'device') => {
    store = new LocalStore(path, deviceId);

    const adapters = new AdapterRegistry(deviceId),
      permissions = new PermissionBroker();

    cleanups.push(() => permissions.close());

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

    const monitor = new Monitor({ deviceId, store, adapters, permissions });

    return { store, adapters, monitor };
  };

  cleanups.push(() => store.close());

  return { open, path };
}

it('restores exact native source IDs, paths and titles without resurrecting command authority', async () => {
  const f = fixture(),
    first = f.open();

  first.monitor.ingestHook(
    {
      hook_event_name: 'SessionStart',
      session_id: 'source-exact',
      model: 'claude-sonnet-4-6',
      transcript_path: '/root/source-exact.jsonl',
    },
    'native',
  );

  const original = structuredClone(first.monitor.findClaude('native', 'source-exact')!);

  first.monitor.setSessionTitle(original.id, 'Retained title');
  first.store.close();

  const restarted = f.open(),
    restored = restarted.monitor.session(original.id)!;

  expect(restored).toBeDefined();
  expect(restored.target).toEqual(original.target);
  expect(restored.claudeSessionId).toBe('source-exact');
  expect(restored.title).toBe('Retained title');
  expect(restored.model).toBe('claude-sonnet-4-6');
  expect(restored.generation).not.toBe(original.generation);
  expect(restored.binding).toBe('unverified');
  expect(restored.status).toBe('unknown');

  expect(restored.capabilities).toMatchObject({
    observe: true,
    history: true,
    prompt: false,
    interrupt: false,
    permission: false,
    terminalSnapshot: false,
  });

  expect(restarted.monitor.binding(original.id)).toBeUndefined();
  expect(await restarted.adapters.get('native')!.discover()).toEqual([]);
  expect(restarted.store.nativeSessions()[0]?.transcriptPath).toBe('/root/source-exact.jsonl');
  expect(statSync(f.path).mode & 0o777).toBe(0o600);
  restarted.monitor.ingestHook({ hook_event_name: 'Stop', session_id: 'source-exact' }, 'native');
  expect(restarted.monitor.findClaude('native', 'source-exact')?.id).toBe(original.id);
});

it('does not restore registrations belonging to a different configured device', () => {
  const f = fixture(),
    first = f.open();

  first.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'source' }, 'native');
  first.store.close();
  expect(f.open('different-device').monitor.snapshot().sessions).toEqual([]);
});

it('filters retired sessions before batching and does not skip active events on backpressure or restart', () => {
  const f = fixture(),
    { store } = f.open();

  for (let i = 0; i < 150; i++) {
    store.append({ sessionId: 'retired', type: 'status', payload: {}, occurredAt: Date.now() });
  }

  const active = Array.from({ length: 3 }, () =>
    store.append({ sessionId: 'active', type: 'message', payload: {}, occurredAt: Date.now() }),
  );

  const sent: EventEnvelope[] = [];
  let capacity = 1;

  const replay = new EventReplay(
    store,
    () => new Set(['active']),
    (event) => {
      if (!capacity) {
        return false;
      }

      capacity--;
      sent.push(event);

      return true;
    },
  );

  replay.flush();
  expect(sent.map((event) => event.seq)).toEqual([active[0]!.seq]);
  expect(store.acknowledgedCursor().seq).toBe(0);
  replay.acknowledge({ streamId: active[0]!.streamId, seq: active[0]!.seq });
  store.close();
  const restarted = f.open().store;
  const recovered: EventEnvelope[] = [];

  new EventReplay(
    restarted,
    () => new Set(['active']),
    (event) => {
      recovered.push(event);

      return true;
    },
  ).flush();

  expect(recovered.map((event) => event.seq)).toEqual(active.slice(1).map((event) => event.seq));
});

it('replays retained active events after pruning instead of acknowledging the newest cursor', () => {
  const { store } = fixture().open();

  store.append({ sessionId: 'retired', type: 'status', payload: {}, occurredAt: 1 });

  const retained = store.append({
    sessionId: 'active',
    type: 'message',
    payload: {},
    occurredAt: Date.now(),
  });

  store.prune();
  const sent: EventEnvelope[] = [];

  new EventReplay(
    store,
    () => new Set(['active']),
    (event) => {
      sent.push(event);

      return true;
    },
  ).flush();

  expect(sent).toEqual([retained]);
  expect(store.acknowledgedCursor().seq).toBe(0);
});

function restoredAtQuota() {
  const f = fixture(),
    first = f.open();

  const originals = [];

  for (let index = 0; index < 10; index++) {
    first.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'saved-' + index }, 'native');
    const session = first.monitor.findClaude('native', 'saved-' + index)!;

    // Future timestamps also exercise protection when the machine clock moves backwards.
    session.lastEventAt = Date.now() + 10000 + index;
    first.store.saveNativeSession(session);
    originals.push(structuredClone(session));
  }

  first.store.close();

  return { ...f.open(), originals };
}

it('makes room for a fresh source by retiring the oldest untouched restored native session', () => {
  const { monitor, store, originals } = restoredAtQuota();

  expect(() =>
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'fresh' }, 'native'),
  ).not.toThrow();

  expect(monitor.snapshot().sessions).toHaveLength(10);
  expect(monitor.findClaude('native', 'fresh')?.binding).toBe('verified');
  expect(monitor.session(originals[0]!.id)).toBeUndefined();
  expect(store.nativeSessions().some(({ session }) => session.id === originals[0]!.id)).toBe(false);
  expect(store.nativeSessions()).toHaveLength(10);
});

it('protects a restored source that receives any fresh hook from fallback eviction', () => {
  const { monitor, originals } = restoredAtQuota();

  monitor.ingestHook({ hook_event_name: 'PostToolUse', session_id: 'saved-0' }, 'native');

  expect(() =>
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'fresh' }, 'native'),
  ).not.toThrow();

  expect(monitor.session(originals[0]!.id)).toBeDefined();
  expect(monitor.session(originals[1]!.id)).toBeUndefined();
});

it('does not evict verified active native or managed sessions to admit a new source', () => {
  const { monitor, adapters } = fixture().open();
  const descriptor = adapters.get('native')!.descriptor();

  adapters.register(new SourceAdapter({ ...descriptor, connectorId: 'managed', transport: 'pty' }));

  for (let index = 0; index < 10; index++) {
    const connectorId = index < 5 ? 'native' : 'managed';

    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'active-' + index }, connectorId);
    monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'active-' + index }, connectorId);
  }

  const originalIds = monitor.snapshot().sessions.map((session) => session.id);

  expect(() =>
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'fresh' }, 'native'),
  ).toThrow('SESSION_QUOTA');

  expect(monitor.snapshot().sessions.map((session) => session.id)).toEqual(originalIds);
});

it('allows managed session creation to reclaim restored observers instead of blocking at the quota', () => {
  const f = fixture(),
    first = f.open();

  for (let i = 0; i < 10; i++) {
    first.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'source-' + i }, 'native');
  }

  expect(first.monitor.canCreateSession()).toBe(false);
  first.store.close();
  const restarted = f.open();

  expect(restarted.monitor.snapshot().sessions).toHaveLength(10);
  expect(restarted.monitor.canCreateSession()).toBe(true);
  restarted.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'new-source' }, 'native');
  expect(restarted.monitor.snapshot().sessions).toHaveLength(10);
  expect(restarted.monitor.findClaude('native', 'new-source')?.binding).toBe('verified');
});
