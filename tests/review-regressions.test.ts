import { afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry, SourceAdapter } from '../apps/daemon/src/adapters/registry.js';
import { Dispatcher } from '../apps/daemon/src/commands/dispatcher.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { installHooks } from '../apps/daemon/src/code/hooks/install-hooks.js';
import { createDesktopSource } from '../apps/daemon/src/desktop/adapter.js';
import { BridgeClient } from '../apps/daemon/src/desktop/bridge-client.js';
import type { Command } from '@protocol';

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
});

async function fixture(driver: { prompt?: () => Promise<{ status: 'dispatched' }> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'review-fix-'));

  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(join(directory, 'state.sqlite'), 'd');

  cleanup.push(() => store.close());
  const broker = new PermissionBroker();

  cleanup.push(() => broker.close());
  const adapters = new AdapterRegistry('d');

  const descriptor = {
    connectorId: 'managed',
    kind: 'claude-code-cli' as const,
    transport: 'pty' as const,
    sourceVersion: 'test',
    capabilities: {
      observe: true,
      history: true,
      prompt: true,
      interrupt: true,
      permission: true,
      terminalSnapshot: false,
    },
    state: 'ready' as const,
    reason: null,
  };

  const adapter = new SourceAdapter(descriptor, {
    prompt: async () => (driver.prompt ? driver.prompt() : { status: 'dispatched' }),
    interrupt: async () => ({ status: 'dispatched' }),
  });

  adapters.register(adapter);
  const monitor = new Monitor({ deviceId: 'd', store, adapters, permissions: broker });

  monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 's' }, 'managed');
  monitor.ingestHook({ hook_event_name: 'Stop', session_id: 's' }, 'managed');
  const session = monitor.snapshot().sessions[0]!;

  const dispatcher = new Dispatcher({
    deviceId: 'd',
    store,
    monitor,
    adapters,
    permissions: broker,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  const command: Command = {
    version: 1,
    commandId: 'first',
    target: session.target,
    sessionId: session.id,
    generation: session.generation,
    expiresAt: Date.now() + 15000,
    action: { type: 'prompt', text: 'hello' },
  };

  return { directory, store, broker, adapters, monitor, dispatcher, command, adapter, descriptor };
}

describe('review regressions', () => {
  it('cancels queued commands from an offline connection epoch', async () => {
    let release!: () => void;
    let started!: () => void;
    let calls = 0;

    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      begin = new Promise<void>((resolve) => {
        started = resolve;
      });

    const f = await fixture({
      prompt: async () => {
        calls++;
        started();
        await gate;

        return { status: 'dispatched' };
      },
    });

    const first = f.dispatcher.dispatch(f.command);

    await begin;
    const second = f.dispatcher.dispatch({ ...f.command, commandId: 'queued' });

    f.dispatcher.setConnection(false);
    f.dispatcher.setConnection(true);
    release();
    await first;
    expect((await second).code).toBe('DEVICE_OFFLINE');
    expect(calls).toBe(1);
  });

  it('tolerates a bounded server/Mac clock skew instead of rejecting valid TTLs', async () => {
    const f = await fixture();

    expect((await f.dispatcher.dispatch({ ...f.command, expiresAt: Date.now() + 20000 })).status).toBe(
      'dispatched',
    );
  });

  it('retires ended sessions and explicitly replaces a disconnected connector', async () => {
    const f = await fixture();

    for (let i = 0; i < 15; i++) {
      f.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 's' + i }, 'managed');
      f.monitor.ingestHook({ hook_event_name: 'SessionEnd', session_id: 's' + i }, 'managed');
    }

    expect(f.monitor.snapshot().sessions.length).toBeLessThanOrEqual(10);
    await f.adapters.disconnect('managed');
    expect(() => f.adapters.register(new SourceAdapter(f.descriptor))).not.toThrow();
  });

  it('sets initial verified managed sessions ready for a first remote prompt', async () => {
    const f = await fixture();

    f.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'fresh' }, 'managed');
    expect(f.monitor.findClaude('managed', 'fresh')?.status).toBe('idle');
  });

  it('installs hooks in an absent fresh configuration directory', async () => {
    const f = await fixture();

    const backup = await installHooks(
      join(f.directory, 'new', 'nested', 'settings.json'),
      '/absolute/remote.mjs',
    );

    expect(backup).toContain('backup');
  });

  it('does not advertise Desktop Code permissions without verified hook identity', () => {
    const base = { bindingId: 'b', generation: 'g', canPrompt: true, canHistory: true, canInterrupt: true };
    const bridge = { request: async () => ({ status: 'dispatched' }) };

    expect(() =>
      createDesktopSource('code', 'd', base, bridge, { inputEnabled: true, permissionsEnabled: true }),
    ).toThrow('DESKTOP_CODE_ID_UNVERIFIED');

    const source = createDesktopSource('code', 'd', { ...base, claudeSessionId: 'real-s' }, bridge, {
      inputEnabled: true,
      permissionsEnabled: true,
    });

    expect(source.adapter.descriptor().capabilities.permission).toBe(false);
  });

  it('does not let the timed-out helper exit clear a replacement process', async () => {
    const f = await fixture();

    const flag = join(f.directory, 'first'),
      binary = join(f.directory, 'helper');

    await writeFile(
      binary,
      `#!${process.execPath}\nconst fs=require('node:fs');if(!fs.existsSync(${JSON.stringify(flag)})){fs.writeFileSync(${JSON.stringify(flag)},'1');process.stdin.resume();setInterval(()=>{},1000);}else{process.stdin.once('data',()=>process.stdout.write(JSON.stringify({ok:true,result:{replacement:true}})+'\\n'));}`,
    );

    await chmod(binary, 0o700);
    const bridge = new BridgeClient(binary);

    cleanup.push(() => bridge.close());
    await expect(bridge.request({ operation: 'probe' })).rejects.toThrow('HELPER_TIMEOUT');
    await expect(bridge.request({ operation: 'probe' })).resolves.toEqual({ replacement: true });
  });
});

it('records unknown after the wrapper receives a prompt and disconnects before its receipt', async () => {
  const { startHookServer } = await import('../apps/daemon/src/code/hooks/hook-server.js');
  const { requestLocal, lineReader, writeFrame } = await import('../apps/daemon/src/code/hooks/ipc.js');
  const f = await fixture();

  const path = join(f.directory, 'hook.sock'),
    id = randomUUID();

  const server = await startHookServer({
    path,
    token: 'local',
    monitor: f.monitor,
    adapters: f.adapters,
    permissions: f.broker,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  cleanup.push(() => server.close());
  const socket = connect(path);

  cleanup.push(() => {
    socket.destroy();
  });

  socket.on('error', () => {});

  await new Promise<void>((resolve) => {
    socket.on('connect', () => writeFrame(socket, { type: 'wrapper', token: 'local', wrapperId: id }));

    lineReader(socket, (value) => {
      const raw = value as { type: 'registered' } | { type: 'request'; id: string; action: { type: string } };

      if (raw.type === 'registered') {
        resolve();
      }

      if (raw.type === 'request') {
        if (raw.action.type === 'prompt') {
          socket.destroy();
        } else {
          writeFrame(socket, { type: 'response', id: raw.id, result: { status: 'dispatched' } });
        }
      }
    });
  });

  await requestLocal(path, {
    type: 'hook',
    token: 'local',
    wrapperId: id,
    payload: { hook_event_name: 'SessionStart', session_id: 'post-write' },
  });

  const session = f.monitor.findClaude(id, 'post-write')!;

  const result = await f.dispatcher.dispatch({
    ...f.command,
    commandId: 'post-write',
    sessionId: session.id,
    target: session.target,
    generation: session.generation,
  });

  expect(result).toMatchObject({ status: 'unknown', code: 'UNKNOWN_AFTER_WRITE' });
});

it('rejects before any effect when the durable command store cannot begin', async () => {
  let calls = 0;

  const f = await fixture({
    prompt: async () => {
      calls++;

      return { status: 'dispatched' };
    },
  });

  f.store.begin = () => {
    throw new Error('database unavailable');
  };

  await expect(f.dispatcher.dispatch(f.command)).resolves.toMatchObject({
    status: 'rejected',
    code: 'COMMAND_STORE_UNAVAILABLE',
  });

  expect(calls).toBe(0);
});

it('reports unknown if persisting a completed effect fails', async () => {
  const f = await fixture();

  f.store.finish = () => {
    throw new Error('disk full');
  };

  await expect(f.dispatcher.dispatch(f.command)).resolves.toMatchObject({
    status: 'unknown',
    code: 'COMMAND_STORE_UNAVAILABLE',
  });
});
