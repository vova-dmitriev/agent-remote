import { expect, it, vi } from 'vitest';
import { TargetKind } from '@protocol';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { cmuxAttacher } from '@daemon/cmux/attach.js';
import { discoverCmuxSessions, restoreCmuxSessions } from '@daemon/cmux/restore.js';
import { registerNativeAdapter } from '@daemon/runtime/wiring/native-adapter.js';
import type { CmuxSurface } from '@daemon/cmux/context.js';

const WINDOW = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const LIVE = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';

function daemon(store: LocalStore, permissions: PermissionBroker) {
  const adapters = new AdapterRegistry('device');

  registerNativeAdapter(adapters, false);

  const attach = cmuxAttacher({
    adapters,
    inputEnabled: true,
    permissionsEnabled: false,
    resolve: async (surface: CmuxSurface) => ({ windowId: WINDOW, ...surface }),
    terminal: { pasteAndSubmit: vi.fn(), sendEscape: vi.fn(), sendEnter: vi.fn(), readScreen: vi.fn() },
  });

  return { attach, adapters, monitor: new Monitor({ deviceId: 'device', store, adapters, permissions }) };
}

it('brings back idle cmux sessions after a restart while their Claude process still runs', async () => {
  const store = new LocalStore(':memory:', 'device'),
    permissions = new PermissionBroker();

  try {
    const first = daemon(store, permissions);

    for (const [surfaceId, session] of [
      [LIVE, 'live'],
      [GONE, 'gone'],
    ] as const) {
      const target = await first.attach({ workspaceId: WORKSPACE, surfaceId }, 'device');

      first.monitor.ingestHook(
        { hook_event_name: 'Stop', session_id: session, transcript_path: `/synthetic/${session}.jsonl` },
        surfaceId,
        target,
        { verifiedTerminal: true },
      );
    }

    const next = daemon(store, permissions);
    const onTranscript = vi.fn();

    expect(next.monitor.snapshot().sessions).toHaveLength(0);

    await restoreCmuxSessions({
      saved: store.cmuxSessions(),
      attach: next.attach,
      running: async (claudeSessionId) => claudeSessionId === 'live',
      monitor: next.monitor,
      onTranscript,
    });

    const sessions = next.monitor.snapshot().sessions;

    expect(sessions.map((session) => session.claudeSessionId)).toEqual(['live']);
    expect(sessions[0]!.target.kind).toBe(TargetKind.Cmux);
    expect(sessions[0]!.capabilities.prompt).toBe(true);
    expect(onTranscript).toHaveBeenCalledWith(sessions[0]!.id, '/synthetic/live.jsonl');
  } finally {
    permissions.close();
    store.close();
  }
});

it('finds live Claude processes in cmux that this daemon never saw, without a turn-end event', async () => {
  const store = new LocalStore(':memory:', 'device'),
    permissions = new PermissionBroker();

  try {
    const { attach, monitor } = daemon(store, permissions);
    const onTranscript = vi.fn();
    const events: string[] = [];

    monitor.on('event', (event: { type: string }) => events.push(event.type));

    await discoverCmuxSessions({
      deviceId: 'device',
      live: async () => [
        { pid: 1, sessionId: 'in-cmux', cwd: '/synthetic/project' },
        { pid: 2, sessionId: 'plain-terminal', cwd: '/synthetic/project' },
      ],
      surface: async (pid) => (pid === 1 ? { workspaceId: WORKSPACE, surfaceId: LIVE } : undefined),
      transcript: async (id) => `/synthetic/${id}.jsonl`,
      attach,
      monitor,
      onTranscript,
    });

    const sessions = monitor.snapshot().sessions;

    expect(sessions.map((session) => session.claudeSessionId)).toEqual(['in-cmux']);
    expect(sessions[0]!.target.kind).toBe(TargetKind.Cmux);
    expect(sessions[0]!.cwd).toBe('/synthetic/project');
    expect(onTranscript).toHaveBeenCalledWith(sessions[0]!.id, '/synthetic/in-cmux.jsonl');
    expect(events).not.toContain('turn_end');
  } finally {
    permissions.close();
    store.close();
  }
});

it('lists a cmux surface connector only while a session runs there, so closed tabs never fill a snapshot', async () => {
  const store = new LocalStore(':memory:', 'device'),
    permissions = new PermissionBroker();

  try {
    const { attach, monitor, adapters } = daemon(store, permissions);
    const target = await attach({ workspaceId: WORKSPACE, surfaceId: LIVE }, 'device');

    await attach({ workspaceId: WORKSPACE, surfaceId: GONE }, 'device');

    monitor.ingestHook({ hook_event_name: 'Notification', session_id: 'live' }, LIVE, target, {
      verifiedTerminal: true,
    });

    const listed = adapters.list(monitor.snapshot().sessions).map((connector) => connector.connectorId);

    expect(listed).toContain(LIVE);
    expect(listed).not.toContain(GONE);
    expect(listed).toContain('native');
  } finally {
    permissions.close();
    store.close();
  }
});
