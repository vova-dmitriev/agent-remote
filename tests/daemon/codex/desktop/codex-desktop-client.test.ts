import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { DesktopCodexClient } from '../../../../apps/daemon/src/codex/desktop/desktop-client.js';
import type { DesktopIpcClient } from '../../../../apps/daemon/src/codex/desktop/desktop-ipc.js';
import type { Data } from '../../../../apps/daemon/src/codex/events.js';
import { bindCodex } from '../../../../apps/daemon/src/codex/binding/binding.js';
import { LocalStore } from '../../../../apps/daemon/src/monitor/store.js';
import { Monitor } from '../../../../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../../../../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../../../../apps/daemon/src/commands/permission-broker.js';

class Ipc extends EventEmitter {
  follows = 0;
  state: Data = {
    id: 'thread',
    title: 'Original',
    requests: [],
    turns: [{ turnId: 'old', status: 'completed', items: [] }],
    threadRuntimeStatus: { type: 'idle' },
  };
  async owner() {
    return 'owner';
  }
  broadcast(_method: string, params: Data) {
    if (params.following) {
      this.follows++;
      this.snapshot();
    }
  }
  async request(_method: string, _params: Data, _owner: unknown) {
    return {};
  }
  snapshot(extra: Data = {}) {
    this.emit('broadcast', {
      method: 'thread-stream-state-changed',
      version: 11,
      sourceClientId: 'owner',
      params: {
        conversationId: 'thread',
        hostId: 'local',
        change: { type: 'snapshot', revision: 1, conversationState: structuredClone(this.state) },
      },
      ...extra,
    });
  }
  patches(baseRevision: number, revision: number, patches: unknown[]) {
    this.emit('broadcast', {
      method: 'thread-stream-state-changed',
      version: 11,
      sourceClientId: 'owner',
      params: {
        conversationId: 'thread',
        hostId: 'local',
        change: { type: 'patches', baseRevision, revision, patches },
      },
    });
  }
}

async function fixture() {
  const ipc = new Ipc();
  const client = await DesktopCodexClient.attach(ipc as unknown as DesktopIpcClient, 'thread');

  return { ipc, client };
}

it('ignores foreign owners, hosts, threads and protocol versions and resynchronizes stale patches', async () => {
  const { ipc, client } = await fixture();

  const read = async () =>
    ((await client.request('thread/read', { threadId: 'thread' })) as { thread: Data }).thread;

  ipc.state.title = 'Wrong';
  ipc.snapshot({ sourceClientId: 'other' });
  ipc.snapshot({ version: 12 });
  ipc.snapshot({ params: { conversationId: 'other', hostId: 'local', change: {} } });
  ipc.snapshot({ params: { conversationId: 'thread', hostId: 'remote', change: {} } });
  expect((await read()).name).toBe('Original');
  ipc.patches(1, 2, [{ op: 'replace', path: ['title'], value: 'Changed' }]);
  expect((await read()).name).toBe('Changed');
  ipc.state.title = 'Recovered';
  ipc.patches(0, 3, []);
  expect(ipc.follows).toBe(2);
  expect((await read()).name).toBe('Recovered');
  await client.close();
});

it('never treats an old completed turn as evidence that an ambiguous new write started', async () => {
  const { client } = await fixture();

  await expect(
    client.request('turn/start', { threadId: 'thread', input: [{ type: 'text', text: 'Synthetic' }] }),
  ).rejects.toThrow('UNKNOWN_AFTER_WRITE');

  await client.close();
});

it('bounds repeated desktop snapshots to the same 500-item window as history', async () => {
  const { ipc, client } = await fixture();

  ipc.state.turns = Array.from({ length: 100 }, (_, turn) => ({
    turnId: String(turn),
    status: 'completed',
    items: Array.from({ length: 6 }, (_, item) => ({
      id: String(item),
      type: 'agentMessage',
      text: 'Synthetic ' + turn + ':' + item,
    })),
  }));

  const frames: unknown[] = [];

  client.on('notification', (frame) => {
    if (frame.method === 'item/completed') {
      frames.push(frame);
    }
  });

  ipc.snapshot();
  expect(frames).toHaveLength(500);
  await client.close();
});

it('does not publish an answered approval again before the owning app removes it', async () => {
  const { ipc, client } = await fixture();
  const requests: unknown[] = [];

  client.on('request', (frame) => requests.push(frame));

  ipc.state.requests = [
    {
      id: 'approval',
      method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread', turnId: 't', itemId: 'f' },
    },
  ];

  ipc.snapshot();
  expect(requests).toHaveLength(1);
  client.respond('approval', { decision: 'accept' });
  ipc.snapshot();
  expect(requests).toHaveLength(1);
  ipc.state.requests = [];
  ipc.snapshot();
  expect(() => client.respond('approval', { decision: 'accept' })).toThrow('PERMISSION_EXPIRED');
  await client.close();
});

it('replays a pre-existing approval once after exact active-turn hydration on attach and reconnect', async () => {
  const ipc = new Ipc();

  ipc.state.turns = [{ turnId: 'pending-turn', status: 'inProgress', items: [] }];
  ipc.state.threadRuntimeStatus = { type: 'active', activeFlags: ['waitingOnApproval'] };

  ipc.state.requests = [
    {
      id: 'existing-request',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread', turnId: 'pending-turn', itemId: 'command', command: 'printf synthetic' },
    },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await DesktopCodexClient.attach(ipc as unknown as DesktopIpcClient, 'thread');

    const store = new LocalStore(':memory:', 'device'),
      adapters = new AdapterRegistry('device'),
      permissions = new PermissionBroker();

    const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

    const bound = await bindCodex(
      { kind: 'codex-desktop', endpoint: '/synthetic/ipc', threadId: 'thread' },
      { rpc: client, monitor, adapters, permissions, inputEnabled: true, permissionsEnabled: true },
    );

    try {
      expect(permissions.pending()).toHaveLength(1);
      ipc.snapshot();
      expect(permissions.pending()).toHaveLength(1);
      const pending = permissions.pending()[0]!;

      expect(permissions.resolve(pending.requestId, bound.session.generation, 'allow')).toBe(true);
      expect(permissions.resolve(pending.requestId, bound.session.generation, 'allow')).toBe(false);
    } finally {
      bound.close();
      await client.close();
      permissions.close();
      store.close();
    }
  }
});

it('exposes only the exact desktop thread model settings and follows native setting changes', async () => {
  const { ipc, client } = await fixture();

  const read = async () =>
    ((await client.request('thread/read', { threadId: 'thread' })) as { thread: Data }).thread;

  expect((await read()).model).toBeUndefined();
  ipc.state.latestModel = 'gpt-desktop';
  ipc.snapshot();
  expect((await read()).model).toBe('gpt-desktop');
  ipc.state.latestCollaborationMode = { settings: { model: 'gpt-mode' } };
  const frames: Data[] = [];

  client.on('notification', (frame) => frames.push(frame));
  ipc.snapshot();
  expect((await read()).model).toBe('gpt-mode');

  expect(frames).toContainEqual({
    method: 'thread/model/updated',
    params: { threadId: 'thread', model: 'gpt-mode' },
  });

  await client.close();
});

it('distinguishes an executing desktop tool from completed history without exposing its arguments', async () => {
  const { ipc, client } = await fixture();
  const frames: Data[] = [];

  client.on('notification', (frame: Data) => frames.push(frame));

  ipc.state.turns = [
    {
      turnId: 'live',
      status: 'inProgress',
      items: [
        { id: 'finished', type: 'commandExecution', status: 'completed' },
        {
          id: 'active-tool',
          type: 'commandExecution',
          status: 'inProgress',
          command: 'private test argument',
        },
      ],
    },
  ];

  ipc.snapshot();

  expect(frames).toContainEqual(
    expect.objectContaining({
      method: 'item/started',
      params: expect.objectContaining({
        turnId: 'live',
        item: expect.objectContaining({ id: 'active-tool' }),
      }),
    }),
  );

  expect(frames).toContainEqual(
    expect.objectContaining({
      method: 'item/completed',
      params: expect.objectContaining({ item: expect.objectContaining({ id: 'finished' }) }),
    }),
  );

  await client.close();
});

it('maps steering to the native owner IPC and rejects stale active-turn input without starting a turn', async () => {
  const ipc = new Ipc();

  ipc.state.turns = [{ turnId: 'busy-turn', status: 'inProgress', items: [] }];
  ipc.state.threadRuntimeStatus = { type: 'active' };
  const calls: { method: string; params: Data; owner: unknown }[] = [];

  ipc.request = async (method: string, params: Data, owner: unknown) => {
    calls.push({ method, params, owner });

    return { result: { turnId: 'busy-turn' } };
  };

  const client = await DesktopCodexClient.attach(ipc as unknown as DesktopIpcClient, 'thread');

  try {
    await expect(
      client.request('turn/steer', {
        threadId: 'thread',
        expectedTurnId: 'stale-turn',
        input: [{ type: 'text', text: 'Synthetic' }],
      }),
    ).rejects.toThrow('STALE_SESSION');

    expect(calls).toHaveLength(0);

    expect(
      await client.request('turn/steer', {
        threadId: 'thread',
        expectedTurnId: 'busy-turn',
        input: [{ type: 'text', text: 'Synthetic steering' }],
      }),
    ).toEqual({ turnId: 'busy-turn' });

    expect(calls).toHaveLength(1);

    expect(calls[0]).toMatchObject({
      method: 'thread-follower-steer-turn',
      owner: 'owner',
      params: {
        conversationId: 'thread',
        input: [{ type: 'text', text: 'Synthetic steering' }],
        restoreMessage: { text: 'Synthetic steering', context: { prompt: 'Synthetic steering' } },
      },
    });
  } finally {
    await client.close();
  }
});

it('reports an unknown steering outcome for a native receipt from a different turn without retrying', async () => {
  const ipc = new Ipc();

  ipc.state.turns = [{ turnId: 'busy-turn', status: 'inProgress', items: [] }];
  ipc.state.threadRuntimeStatus = { type: 'active' };
  let calls = 0;

  ipc.request = async () => {
    calls++;

    return { result: { turnId: 'different-turn' } };
  };

  const client = await DesktopCodexClient.attach(ipc as unknown as DesktopIpcClient, 'thread');

  try {
    await expect(
      client.request('turn/steer', {
        threadId: 'thread',
        expectedTurnId: 'busy-turn',
        input: [{ type: 'text', text: 'Synthetic steering' }],
      }),
    ).rejects.toThrow('UNKNOWN_AFTER_WRITE');

    expect(calls).toBe(1);
  } finally {
    await client.close();
  }
});

it('fails attach at once when the thread snapshot is too large instead of waiting for the timeout', async () => {
  const ipc = new Ipc();

  ipc.broadcast = (_method: string, params: Data) => {
    if (params.following) {
      ipc.emit('frame_too_large', { conversationId: 'thread', sourceClientId: 'owner' });
    }
  };

  const started = Date.now();

  await expect(DesktopCodexClient.attach(ipc as unknown as DesktopIpcClient, 'thread')).rejects.toMatchObject(
    {
      code: 'CODEX_FRAME_TOO_LARGE',
    },
  );

  expect(Date.now() - started).toBeLessThan(1000);
  expect(ipc.listenerCount('broadcast')).toBe(0);
  expect(ipc.listenerCount('frame_too_large')).toBe(0);
});

it('loses only its own thread when an oversize frame names that thread and owner', async () => {
  const { ipc, client } = await fixture();
  const lost: unknown[] = [];

  client.on('disconnected', (error) => lost.push(error));
  ipc.emit('frame_too_large', { conversationId: 'other-thread', sourceClientId: 'owner' });
  ipc.emit('frame_too_large', { conversationId: 'thread', sourceClientId: 'other-owner' });
  expect(lost).toEqual([]);

  ipc.emit('frame_too_large', { conversationId: 'thread', sourceClientId: 'owner' });
  expect(lost).toMatchObject([{ code: 'CODEX_FRAME_TOO_LARGE' }]);
  await client.close();
});
