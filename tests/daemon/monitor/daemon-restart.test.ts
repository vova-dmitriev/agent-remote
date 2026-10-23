import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { EventReplay } from '@daemon/monitor/replay.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { AdapterRegistry, SourceAdapter } from '@daemon/adapters/registry.js';
import { EventType, MAX_DEVICE_SESSIONS, MessageRole, type EventEnvelope } from '@protocol';

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

  for (let index = 0; index < MAX_DEVICE_SESSIONS; index++) {
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

it('keeps a fresh source when the bounded snapshot is full', () => {
  const { monitor, store, originals } = restoredAtQuota();

  expect(() =>
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'fresh' }, 'native'),
  ).not.toThrow();

  expect(monitor.snapshot().sessions).toHaveLength(MAX_DEVICE_SESSIONS);
  expect(monitor.findClaude('native', 'fresh')?.binding).toBe('verified');
  expect(monitor.session(originals[0]!.id)).toBeDefined();
  const listed = store.sessionPage('all');
  const pages = [listed];

  while (pages.at(-1)!.nextCursor) {
    pages.push(store.sessionPage('all', pages.at(-1)!.nextCursor!));
  }

  expect(pages.flatMap((page) => page.sessions).some((session) => session.claudeSessionId === 'fresh')).toBe(
    true,
  );

  expect(store.nativeSessions()).toHaveLength(MAX_DEVICE_SESSIONS);
});

it('does not evict restored sources when admitting another source', () => {
  const { monitor, originals } = restoredAtQuota();

  monitor.ingestHook({ hook_event_name: 'PostToolUse', session_id: 'saved-0' }, 'native');

  expect(() =>
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'fresh' }, 'native'),
  ).not.toThrow();

  expect(monitor.session(originals[0]!.id)).toBeDefined();
  expect(monitor.session(originals[1]!.id)).toBeDefined();
});

it('keeps verified active native and managed sessions when admitting a new source', () => {
  const { monitor, adapters } = fixture().open();
  const descriptor = adapters.get('native')!.descriptor();

  adapters.register(new SourceAdapter({ ...descriptor, connectorId: 'managed', transport: 'pty' }));

  for (let index = 0; index < MAX_DEVICE_SESSIONS; index++) {
    const connectorId = index < MAX_DEVICE_SESSIONS / 2 ? 'native' : 'managed';

    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'active-' + index }, connectorId);
    monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'active-' + index }, connectorId);
  }

  const originalIds = monitor.snapshot().sessions.map((session) => session.id);

  expect(() =>
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'fresh' }, 'native'),
  ).not.toThrow();

  expect(originalIds.every((id) => monitor.session(id))).toBe(true);
  expect(monitor.snapshot().sessions).toHaveLength(MAX_DEVICE_SESSIONS);
});

it('allows managed session creation to reclaim restored observers instead of blocking at the quota', () => {
  const f = fixture(),
    first = f.open();

  for (let i = 0; i < MAX_DEVICE_SESSIONS; i++) {
    first.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'source-' + i }, 'native');
  }

  expect(first.monitor.canCreateSession()).toBe(true);
  first.store.close();
  const restarted = f.open();

  expect(restarted.monitor.snapshot().sessions).toHaveLength(MAX_DEVICE_SESSIONS);
  expect(restarted.monitor.canCreateSession()).toBe(true);
  restarted.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'new-source' }, 'native');
  expect(restarted.monitor.snapshot().sessions).toHaveLength(MAX_DEVICE_SESSIONS);
  expect(restarted.monitor.findClaude('native', 'new-source')?.binding).toBe('verified');
});

it('keeps a pin across restarts and shows it only on the pinned session of the snapshot', () => {
  const f = fixture(),
    first = f.open();

  for (const id of ['pinned-source', 'other-source']) {
    first.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: id }, 'native');
  }

  const pinned = first.monitor.findClaude('native', 'pinned-source')!.id;

  const pins = () =>
    Object.fromEntries(
      f
        .open()
        .monitor.snapshot()
        .sessions.map((s) => [s.id, s.pinned]),
    );

  expect(first.monitor.setPinned('unknown-session', true)).toBe(false);
  expect(first.monitor.setPinned(pinned, true)).toBe(true);
  expect(first.monitor.setPinned(pinned, true)).toBe(false);
  first.store.close();

  const restarted = pins();

  expect(restarted[pinned]).toBe(true);
  expect(Object.values(restarted).filter(Boolean)).toHaveLength(1);

  // Pins live beside the session, never in its saved data.
  expect(
    f
      .open()
      .store.nativeSessions()
      .every(({ session }) => session.pinned === undefined),
  ).toBe(true);
});

it('hides a restored native record once a live session runs the same conversation', () => {
  const f = fixture(),
    first = f.open();

  first.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'shared-conversation' }, 'native');
  const restoredId = first.monitor.findClaude('native', 'shared-conversation')!.id;

  first.store.close();

  const restarted = f.open();

  restarted.adapters.register(
    new SourceAdapter({
      connectorId: 'live-terminal',
      kind: 'claude-code-cli',
      transport: 'pty',
      sourceVersion: 'test',
      state: 'ready',
      reason: null,
      capabilities: {
        observe: true,
        history: true,
        prompt: true,
        interrupt: true,
        permission: false,
        terminalSnapshot: false,
      },
    }),
  );

  expect(restarted.monitor.snapshot().sessions.map((session) => session.id)).toEqual([restoredId]);

  // The same conversation, now live in a terminal the companion runs: the app lists it once, live.
  restarted.monitor.ingestHook(
    { hook_event_name: 'SessionStart', session_id: 'shared-conversation' },
    'live-terminal',
  );

  const live = restarted.monitor.findClaude('live-terminal', 'shared-conversation')!;

  expect(live.binding).toBe('verified');
  expect(restarted.monitor.snapshot().sessions.map((session) => session.id)).toEqual([live.id]);
});

const reply = (id: string, occurredAt: number, extra: object = {}) => ({
  id,
  role: MessageRole.Assistant,
  text: 'Synthetic reply',
  occurredAt,
  ...extra,
});

const unread = (monitor: Monitor, id: string) => monitor.snapshot().sessions.find((s) => s.id === id)?.unread;

it("counts the agent's replies after the read mark, once each, and keeps the mark across restarts", () => {
  const f = fixture(),
    first = f.open();

  first.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'unread-source' }, 'native');
  const id = first.monitor.findClaude('native', 'unread-source')!.id;
  const now = Date.now() + 1000;

  first.monitor.publish(id, EventType.Message, reply('r1', now));
  first.monitor.publish(id, EventType.Message, reply('r1', now));
  first.monitor.publish(id, EventType.Message, reply('r2', now + 1));
  first.monitor.publish(id, EventType.Message, { ...reply('u1', now + 2), role: MessageRole.User });

  first.monitor.publish(
    id,
    EventType.Message,
    reply('t1', now + 3, { tool: { id: 'tool-1', phase: 'completed' } }),
  );

  // A reply written before read marks were kept is history, not news.
  first.monitor.publish(id, EventType.Message, reply('old', 1000));

  expect(unread(first.monitor, id)).toBe(2);
  expect(first.monitor.markRead('unknown-session', now)).toBe(false);
  expect(first.monitor.markRead(id, now)).toBe(true);
  expect(unread(first.monitor, id)).toBe(1);
  first.store.close();

  // The mark and the reply after it come back from the store.
  const second = f.open();

  expect(unread(second.monitor, id)).toBe(1);
  expect(second.monitor.markRead(id, now + 1)).toBe(true);
  expect(unread(second.monitor, id)).toBeUndefined();
  expect(second.monitor.markRead(id, now)).toBe(false);
});
