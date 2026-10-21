import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TargetKind, type CmuxTarget } from '@protocol';
import { startHookServer } from '@daemon/code/hooks/hook-server.js';
import { requestLocal } from '@daemon/code/hooks/ipc.js';
import { localSecret, socketPath } from '@daemon/config.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { cmuxAttacher } from '@daemon/cmux/attach.js';
import { registerNativeAdapter } from '@daemon/runtime/wiring/native-adapter.js';
import { hookCmuxSurface, type CmuxSurface } from '@daemon/cmux/context.js';

const WINDOW = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const SURFACE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const surface: CmuxSurface = { workspaceId: WORKSPACE, surfaceId: SURFACE };

let dir: string;
let previousHome: string | undefined;
let server: Awaited<ReturnType<typeof startHookServer>> | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cmux-attach-'));
  previousHome = process.env.CLAUDE_REMOTE_HOME;
  process.env.CLAUDE_REMOTE_HOME = dir;
});

afterEach(async () => {
  await server?.close();
  server = undefined;

  if (previousHome === undefined) {
    delete process.env.CLAUDE_REMOTE_HOME;
  } else {
    process.env.CLAUDE_REMOTE_HOME = previousHome;
  }

  await rm(dir, { recursive: true, force: true });
});

async function harness(identified: CmuxSurface | 'fail') {
  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  registerNativeAdapter(adapters, false);
  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  const terminal = {
    pasteAndSubmit: vi.fn(async () => {}),
    sendEscape: vi.fn(async () => {}),
    sendEnter: vi.fn(async () => {}),
    readScreen: vi.fn(async () => 'screen'),
  };

  const resolve = vi.fn(async () => {
    if (identified === 'fail') {
      throw new Error('not in cmux');
    }

    return { windowId: WINDOW, ...identified };
  });

  server = await startHookServer({
    path: socketPath(),
    token: await localSecret(),
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
    attachCmux: cmuxAttacher({ adapters, inputEnabled: true, permissionsEnabled: false, resolve, terminal }),
  });

  const hook = async (event: string, cmuxSurface?: CmuxSurface) =>
    requestLocal(socketPath(), {
      type: 'hook',
      token: await localSecret(),
      payload: { hook_event_name: event, session_id: 'synthetic-cmux-session' },
      ...(cmuxSurface ? { cmuxSurface } : {}),
    });

  return { monitor, adapters, terminal, resolve, hook };
}

it('attaches a cmux-started session to its surface so input works without a restart', async () => {
  const { monitor, adapters, terminal, hook } = await harness(surface);

  await hook('UserPromptSubmit', surface);
  const [session] = monitor.snapshot().sessions;

  expect(monitor.snapshot().sessions).toHaveLength(1);

  expect(session!.target).toEqual({
    kind: TargetKind.Cmux,
    deviceId: 'device',
    connectorId: SURFACE,
    windowId: WINDOW,
    workspaceId: WORKSPACE,
    surfaceId: SURFACE,
  });

  expect(session!.binding).toBe('verified');
  expect(session!.capabilities.prompt).toBe(true);

  const adapter = adapters.resolve(session!.target);
  const binding = monitor.binding(session!.id)!;

  await adapter.sendPrompt(binding, 'synthetic-input');
  expect(terminal.pasteAndSubmit).toHaveBeenCalledWith(session!.target as CmuxTarget, 'synthetic-input');

  await adapter.interrupt(binding);
  expect(terminal.sendEscape).toHaveBeenCalledWith(session!.target as CmuxTarget);
});

it('moves an observed-only session onto its surface instead of duplicating it', async () => {
  const { monitor, hook } = await harness(surface);

  await hook('UserPromptSubmit');
  const observed = monitor.snapshot().sessions[0]!;

  expect(observed.capabilities.prompt).toBe(false);

  await hook('Stop', surface);
  const sessions = monitor.snapshot().sessions;

  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.id).toBe(observed.id);
  expect(sessions[0]!.target.kind).toBe(TargetKind.Cmux);
  expect(sessions[0]!.capabilities.prompt).toBe(true);
});

it('keeps the session observe-only when cmux does not confirm the surface', async () => {
  for (const identified of ['fail', { workspaceId: WORKSPACE, surfaceId: OTHER }] as const) {
    const { monitor, hook } = await harness(identified);

    await hook('UserPromptSubmit', surface);
    const [session] = monitor.snapshot().sessions;

    expect(session!.target.kind).toBe(TargetKind.ClaudeCodeCli);
    expect(session!.capabilities.prompt).toBe(false);

    await server!.close();
    server = undefined;
  }
});

it('reads the surface only from well-formed cmux ids', () => {
  expect(hookCmuxSurface({})).toEqual({});
  expect(hookCmuxSurface({ CMUX_WORKSPACE_ID: 'workspace', CMUX_SURFACE_ID: SURFACE })).toEqual({});

  expect(hookCmuxSurface({ CMUX_WORKSPACE_ID: WORKSPACE, CMUX_SURFACE_ID: SURFACE })).toEqual({
    cmuxSurface: surface,
  });
});
