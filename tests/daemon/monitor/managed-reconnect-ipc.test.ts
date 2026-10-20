import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { startHookServer } from '@daemon/code/hooks/hook-server.js';
import { lineReader, requestLocal, writeFrame } from '@daemon/code/hooks/ipc.js';

it('rebinds a surviving authenticated wrapper and its transcript after the daemon control server restarts, without a prompt or child restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-ipc-')),
    path = join(root, 'hooks.sock'),
    token = 'synthetic-secret',
    wrapperId = randomUUID();

  const store = new LocalStore(':memory:', 'device'),
    permissions = new PermissionBroker();

  let socket: Socket | undefined,
    server: Awaited<ReturnType<typeof startHookServer>> | undefined,
    binds = 0;

  const registries = new WeakMap<Monitor, AdapterRegistry>();

  const make = () => {
    const adapters = new AdapterRegistry('device'),
      monitor = new Monitor({ deviceId: 'device', store, permissions, adapters });

    registries.set(monitor, adapters);

    return monitor;
  };

  const first = make();

  const start = async (monitor: Monitor, onTranscript?: (id: string, path: string) => void) =>
    startHookServer({
      path,
      token,
      monitor,
      permissions,
      adapters: registries.get(monitor)!,
      inputEnabled: true,
      permissionsEnabled: false,
      ...(onTranscript ? { onTranscript } : {}),
    });

  const attach = () =>
    new Promise<void>((resolve, reject) => {
      socket = connect(path);
      socket.on('error', reject);
      socket.once('connect', () => writeFrame(socket!, { type: 'wrapper', token, wrapperId }));

      lineReader(socket, (raw) => {
        const frame = raw as { type: string; id: string; action?: { type: string; sessionId: string } };

        if (frame.type === 'registered') {
          resolve();
        }

        if (frame.type === 'request') {
          expect(frame.action).toEqual({ type: 'bind', sessionId: 'original' });
          binds++;
          writeFrame(socket!, { type: 'response', id: frame.id, result: { status: 'dispatched' } });
        }
      });
    });

  try {
    server = await start(first);
    await attach();

    await requestLocal(path, {
      type: 'hook',
      token,
      wrapperId,
      payload: {
        hook_event_name: 'SessionStart',
        session_id: 'original',
        cwd: '/synthetic',
        transcript_path: '/synthetic/source.jsonl',
      },
    });

    const original = first.snapshot().sessions[0]!;

    await server.close();

    const second = make(),
      transcripts: string[] = [];

    server = await start(second, (_id, path) => transcripts.push(path));
    await attach();
    await vi.waitFor(() => expect(second.snapshot().sessions).toHaveLength(1));
    const restored = second.snapshot().sessions[0]!;

    expect(restored.id).toBe(original.id);
    expect(restored.generation).not.toBe(original.generation);
    expect(restored.capabilities.prompt).toBe(true);
    expect(restored.binding).toBe('verified');
    expect(transcripts).toEqual(['/synthetic/source.jsonl']);
    expect(binds).toBe(2);
  } finally {
    socket?.destroy();
    await server?.close();
    permissions.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
