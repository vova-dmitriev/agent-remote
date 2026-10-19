import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { AdapterRegistry } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { Dispatcher } from '../apps/daemon/src/commands/dispatcher.js';
import { CodexModelReader } from '../apps/daemon/src/codex/history/model-reader.js';
import { bindCodex } from '../apps/daemon/src/codex/binding/binding.js';
import { CodexApprovals } from '../apps/daemon/src/codex/binding/approvals.js';
import type { RpcFrame } from '../apps/daemon/src/domain/codex/client.js';

class Rpc extends EventEmitter {
  calls: { method: string; params: unknown }[] = [];
  replies: { id: string | number; result: unknown }[] = [];
  thread = {
    id: 'exact-thread',
    name: 'Codex synthetic',
    canAcceptDirectInput: true,
    status: { type: 'idle' },
    turns: [],
  };
  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });

    if (method === 'thread/loaded/list') {
      return { data: ['exact-thread'] };
    }

    if (method === 'thread/read') {
      return { thread: this.thread };
    }

    if (method === 'thread/resume') {
      return { thread: this.thread, model: 'gpt-synthetic' };
    }

    if (method === 'thread/items/list') {
      return {
        data: [
          {
            turnId: 'initial-turn',
            item: { id: 'initial', type: 'agentMessage', text: 'Synthetic history' },
          },
        ],
        nextCursor: null,
      };
    }

    if (method === 'turn/steer') {
      return { turnId: 'remote-turn' };
    }

    if (method === 'turn/start') {
      return { turn: { id: 'remote-turn', status: 'inProgress' } };
    }

    return {};
  }
  respond(id: string | number, result: unknown) {
    this.replies.push({ id, result });
  }
  reject(_id: string | number) {}
  async close() {}
}
const cleanup: (() => void)[] = [];

afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
);

async function fixture(kind: 'codex-cli' | 'codex-desktop' = 'codex-cli', configure?: (rpc: Rpc) => void) {
  const store = new LocalStore(':memory:', 'device');
  const permissions = new PermissionBroker();

  cleanup.push(
    () => store.close(),
    () => permissions.close(),
  );

  const adapters = new AdapterRegistry('device');
  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });
  const rpc = new Rpc();

  configure?.(rpc);

  const bound = await bindCodex(
    { kind, threadId: 'exact-thread', endpoint: '/private/socket' },
    { rpc, monitor, adapters, permissions, inputEnabled: true, permissionsEnabled: true },
  );

  cleanup.push(() => bound.close());

  const dispatcher = new Dispatcher({
    deviceId: 'device',
    store,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  return { ...bound, rpc, monitor, store, permissions, dispatcher };
}

describe('Codex exact source binding and command dispatch', () => {
  it('leaves disabled and stale approvals in the local owner without automatically denying them', async () => {
    const f = await fixture();

    const request = {
      id: 'local-only',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'exact-thread', turnId: 'active', itemId: 'exec' },
    };

    const disabled = new CodexApprovals(
      f.rpc,
      f.session,
      f.permissions,
      () => 'active',
      () => {},
      false,
    );

    disabled.request(request);

    const enabled = new CodexApprovals(
      f.rpc,
      f.session,
      f.permissions,
      () => 'new-active',
      () => {},
      true,
    );

    enabled.request(request);
    expect(f.permissions.pending()).toHaveLength(0);
    expect(f.rpc.replies).toHaveLength(0);
  });

  it('never treats an unloaded or unknown source state as an idle writable thread', async () => {
    const f = await fixture('codex-cli', (rpc) => {
      rpc.thread.status = { type: 'notLoaded' };
    });

    expect(f.session.status).toBe('unknown');

    const result = await f.dispatcher.dispatch({
      version: 1,
      commandId: 'unloaded',
      target: f.session.target,
      sessionId: f.session.id,
      generation: f.session.generation,
      expiresAt: Date.now() + 15000,
      action: { type: 'prompt', text: 'Must not dispatch' },
    });

    expect(result.status).toBe('rejected');
    expect(f.rpc.calls.some((call) => call.method === 'turn/start')).toBe(false);
  });

  it('does not resurrect a completed turn from a delayed history response and emits one completion', async () => {
    const f = await fixture('codex-cli', (rpc) => {
      rpc.thread.status = { type: 'active' };
      const original = rpc.request.bind(rpc);

      rpc.request = async (method, params) => {
        if (method === 'thread/turns/list') {
          rpc.emit('notification', {
            method: 'turn/started',
            params: { threadId: 'exact-thread', turn: { id: 'ended-during-read' } },
          });

          rpc.emit('notification', {
            method: 'turn/completed',
            params: { threadId: 'exact-thread', turn: { id: 'ended-during-read', status: 'completed' } },
          });

          rpc.emit('notification', {
            method: 'thread/status/changed',
            params: { threadId: 'exact-thread', status: { type: 'idle' } },
          });

          return { data: [{ id: 'ended-during-read', status: 'inProgress' }] };
        }

        return original(method, params);
      };
    });

    const result = await f.dispatcher.dispatch({
      version: 1,
      commandId: 'after-delayed-read',
      target: f.session.target,
      sessionId: f.session.id,
      generation: f.session.generation,
      expiresAt: Date.now() + 15000,
      action: { type: 'prompt', text: 'Next synthetic request' },
    });

    expect(result.status).toBe('dispatched');
    const events = f.store.replay({ ...f.store.cursor(), seq: 0 });

    expect(events !== 'resync_required' && events.filter((event) => event.type === 'turn_end')).toHaveLength(
      1,
    );
  });

  for (const kind of ['codex-cli', 'codex-desktop'] as const) {
    it(`${kind} reads genuine metadata/history and dispatches one turn with durable dedup`, async () => {
      const f = await fixture(kind);
      const session = f.session;

      expect(session.title).toBe('Codex synthetic');
      expect(session.target.kind).toBe(kind);
      expect(session.claudeSessionId).toBeNull();
      expect(session.capabilities.terminalSnapshot).toBe(false);
      const events = f.store.replay({ ...f.store.cursor(), seq: 0 });

      expect(events !== 'resync_required' && events.some((event) => event.type === 'message')).toBe(true);

      const command = {
        version: 1 as const,
        commandId: 'one',
        target: session.target,
        sessionId: session.id,
        generation: session.generation,
        expiresAt: Date.now() + 15000,
        action: { type: 'prompt' as const, text: 'Synthetic remote prompt' },
      };

      expect((await f.dispatcher.dispatch(command)).status).toBe('dispatched');
      expect((await f.dispatcher.dispatch(command)).status).toBe('dispatched');

      expect(f.rpc.calls.filter((call) => call.method === 'turn/start')).toEqual([
        {
          method: 'turn/start',
          params: { threadId: 'exact-thread', input: [{ type: 'text', text: 'Synthetic remote prompt' }] },
        },
      ]);

      expect((await f.dispatcher.dispatch({ ...command, commandId: 'busy' })).code).toBe('SESSION_NOT_IDLE');

      expect(
        (await f.dispatcher.dispatch({ ...command, commandId: 'interrupt', action: { type: 'interrupt' } }))
          .status,
      ).toBe('dispatched');

      expect(f.rpc.calls.at(-1)).toEqual({
        method: 'turn/interrupt',
        params: { threadId: 'exact-thread', turnId: 'remote-turn' },
      });
    });
  }

  it('streams the same item in place and ignores other threads', async () => {
    const f = await fixture();

    const notify = (params: unknown) =>
      f.rpc.emit('notification', { method: 'item/agentMessage/delta', params } satisfies RpcFrame);

    notify({ threadId: 'other', turnId: 't', itemId: 'm', delta: 'Wrong' });
    notify({ threadId: 'exact-thread', turnId: 't', itemId: 'm', delta: 'First ' });
    notify({ threadId: 'exact-thread', turnId: 't', itemId: 'm', delta: 'second' });
    const events = f.store.replay({ ...f.store.cursor(), seq: 0 });

    expect(
      events !== 'resync_required' &&
        events.filter((event) => event.type === 'message').map((event) => event.payload),
    ).toContainEqual(expect.objectContaining({ id: 't:m', text: 'First second' }));
  });

  it('routes one-time approvals and cancels locally resolved or completed turn requests', async () => {
    const f = await fixture();

    f.rpc.emit('notification', {
      method: 'turn/started',
      params: { threadId: 'exact-thread', turn: { id: 't' } },
    });

    const request = {
      method: 'item/commandExecution/requestApproval',
      id: 'server-one',
      params: { threadId: 'exact-thread', turnId: 't', itemId: 'exec', command: 'echo synthetic' },
    };

    f.rpc.emit('request', request);
    expect(f.permissions.pending()).toHaveLength(1);
    const pending = f.permissions.pending()[0]!;

    expect(f.permissions.resolve(pending.requestId, f.session.generation, 'allow')).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.rpc.replies).toEqual([{ id: 'server-one', result: { decision: 'accept' } }]);
    expect(f.permissions.resolve(pending.requestId, f.session.generation, 'allow')).toBe(false);
    f.rpc.emit('request', { ...request, id: 'server-two' });

    f.rpc.emit('notification', {
      method: 'serverRequest/resolved',
      params: { threadId: 'exact-thread', requestId: 'server-two' },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.permissions.pending()).toHaveLength(0);
    expect(f.rpc.replies).toHaveLength(1);
    expect(f.session.status).toBe('running');
    f.rpc.emit('request', { ...request, id: 'server-three' });

    f.rpc.emit('notification', {
      method: 'turn/completed',
      params: { threadId: 'exact-thread', turn: { id: 't', status: 'completed' } },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.permissions.pending()).toHaveLength(0);
  });

  it('invalidates command bindings on disconnect and never upgrades stale sources', async () => {
    const f = await fixture();

    f.rpc.emit('disconnected');
    expect(f.monitor.session(f.session.id)?.binding).toBe('unverified');
    expect(f.monitor.session(f.session.id)?.capabilities.prompt).toBe(false);
  });

  it('does not resurrect a turn completed before its start response arrives', async () => {
    const f = await fixture();
    const request = f.rpc.request.bind(f.rpc);

    f.rpc.request = async (method, params) => {
      if (method !== 'turn/start') {
        return request(method, params);
      }

      f.rpc.emit('notification', {
        method: 'turn/started',
        params: { threadId: 'exact-thread', turn: { id: 'fast' } },
      });

      f.rpc.emit('notification', {
        method: 'turn/completed',
        params: { threadId: 'exact-thread', turn: { id: 'fast', status: 'completed' } },
      });

      return { turn: { id: 'fast', status: 'completed' } };
    };

    const command = {
      version: 1 as const,
      commandId: 'fast-one',
      target: f.session.target,
      sessionId: f.session.id,
      generation: f.session.generation,
      expiresAt: Date.now() + 15000,
      action: { type: 'prompt' as const, text: 'First' },
    };

    expect((await f.dispatcher.dispatch(command)).status).toBe('dispatched');
    expect((await f.dispatcher.dispatch({ ...command, commandId: 'fast-two' })).status).toBe('dispatched');
  });

  it('returns expired approvals to the local source instead of sending an automatic denial', async () => {
    const f = await fixture();

    f.rpc.emit('notification', {
      method: 'turn/started',
      params: { threadId: 'exact-thread', turn: { id: 't' } },
    });

    f.rpc.emit('request', {
      method: 'item/fileChange/requestApproval',
      id: 'local-request',
      params: { threadId: 'exact-thread', turnId: 't', itemId: 'file' },
    });

    f.permissions.cancel(f.permissions.pending()[0]!.requestId);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.rpc.replies).toEqual([]);
  });

  it('replays paginated history oldest first across page boundaries', async () => {
    const f = await fixture('codex-cli', (rpc) => {
      const request = rpc.request.bind(rpc);

      rpc.request = async (method, params) => {
        if (method !== 'thread/items/list') {
          return request(method, params);
        }

        const cursor = (params as { cursor?: string }).cursor;
        const ids = cursor ? ['old-two', 'old-one'] : ['new-two', 'new-one'];

        return {
          data: ids.map((id) => ({ turnId: 't', item: { id, type: 'agentMessage', text: id } })),
          nextCursor: cursor ? null : 'older',
        };
      };
    });

    const events = f.store.replay({ ...f.store.cursor(), seq: 0 });

    expect(
      events !== 'resync_required' &&
        events
          .filter((event) => event.type === 'message')
          .map((event) => (event.payload as { text: string }).text),
    ).toEqual(['old-one', 'old-two', 'new-one', 'new-two']);
  });

  it('exposes only a safe error code when a model turn fails and clears it on the next turn', async () => {
    const f = await fixture();

    f.rpc.emit('notification', {
      method: 'turn/started',
      params: { threadId: 'exact-thread', turn: { id: 'failed' } },
    });

    f.rpc.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'exact-thread',
        turn: {
          id: 'failed',
          status: 'failed',
          error: {
            message: 'This model is not supported for this account. Private server details must not escape.',
          },
        },
      },
    });

    expect(f.monitor.snapshot().sessions[0]).toHaveProperty('errorCode', 'CODEX_MODEL_UNAVAILABLE');
    expect(JSON.stringify(f.monitor.snapshot())).not.toContain('Private server details');

    f.rpc.emit('notification', {
      method: 'turn/started',
      params: { threadId: 'exact-thread', turn: { id: 'retry' } },
    });

    expect(f.monitor.snapshot().sessions[0]).not.toHaveProperty('errorCode');
  });

  it('keeps live streaming text after older backfill when history loads concurrently', async () => {
    const f = await fixture('codex-cli', (rpc) => {
      const request = rpc.request.bind(rpc);

      rpc.request = async (method, params) => {
        if (method !== 'thread/items/list') {
          return request(method, params);
        }

        rpc.emit('notification', {
          method: 'item/agentMessage/delta',
          params: { threadId: 'exact-thread', turnId: 'current', itemId: 'live', delta: 'Newest live text' },
        });

        return {
          data: [{ turnId: 'older', item: { type: 'agentMessage', id: 'old', text: 'Older history' } }],
          nextCursor: null,
        };
      };
    });

    const events = f.store.replay({ ...f.store.cursor(), seq: 0 });

    expect(
      events !== 'resync_required' &&
        events
          .filter((event) => event.type === 'message')
          .map((event) => (event.payload as { text: string }).text),
    ).toEqual(['Older history', 'Newest live text']);
  });
});

it('publishes exact thread model metadata and updates only the matching thread', async () => {
  const f = await fixture();

  expect(f.monitor.snapshot().sessions[0]?.model).toBe('gpt-synthetic');
  f.rpc.emit('notification', { method: 'model/rerouted', params: { threadId: 'other', toModel: 'foreign' } });
  expect(f.session.model).toBe('gpt-synthetic');

  f.rpc.emit('notification', {
    method: 'model/rerouted',
    params: { threadId: 'exact-thread', toModel: 'gpt-next' },
  });

  expect(f.monitor.snapshot().sessions[0]?.model).toBe('gpt-next');
});

it('follows exact native rollout model changes without reading another thread or changing command identity', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codex-model-'));
  const root = join(home, 'sessions');

  await mkdir(root);
  const path = join(root, 'exact-thread.jsonl');

  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id: 'exact-thread' } }) + '\n');
  vi.stubEnv('CODEX_HOME', home);

  cleanup.push(
    () => vi.unstubAllEnvs(),
    () => {
      rmSync(home, { recursive: true, force: true });
    },
  );

  const f = await fixture('codex-cli', (rpc) => Object.assign(rpc.thread, { path }));
  const generation = f.session.generation;

  await appendFile(
    path,
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-native-changed' } }) + '\n',
  );

  await expect
    .poll(() => f.monitor.snapshot().sessions[0]?.model, { timeout: 5000 })
    .toBe('gpt-native-changed');

  expect(f.session.generation).toBe(generation);
  expect(f.session.target).toMatchObject({ threadId: 'exact-thread' });
  expect(f.rpc.calls.filter((call) => call.method === 'turn/start')).toHaveLength(0);
});

it('preserves a newer native model notification that arrives while thread resume is pending', async () => {
  const f = await fixture('codex-cli', (rpc) => {
    const request = rpc.request.bind(rpc);

    rpc.request = async (method, params) => {
      const response = await request(method, params);

      if (method === 'thread/resume') {
        rpc.emit('notification', {
          method: 'model/rerouted',
          params: { threadId: 'exact-thread', toModel: 'gpt-live-newer' },
        });
      }

      return response;
    };
  });

  expect(f.session.model).toBe('gpt-live-newer');
});

it('fences an in-flight rollout read when a newer native model notification arrives', async () => {
  const f = await fixture();

  const read = vi.spyOn(CodexModelReader.prototype, 'read').mockImplementationOnce(async () => {
    f.rpc.emit('notification', {
      method: 'model/rerouted',
      params: { threadId: 'exact-thread', toModel: 'gpt-live-newer' },
    });

    return 'gpt-older-read';
  });

  cleanup.push(() => read.mockRestore());
  await expect.poll(() => f.session.model, { timeout: 4000 }).toBe('gpt-live-newer');
});

it('hydrates message timestamps from native turns instead of the reconnect clock', async () => {
  const f = await fixture('codex-cli', (rpc) => {
    Object.assign(rpc.thread, {
      turns: [{ id: 'initial-turn', startedAt: 1234, status: 'completed', items: [] }],
    });
  });

  const events = f.store.replay({ ...f.store.cursor(), seq: 0 });

  expect(
    events !== 'resync_required' && events.find((event) => event.type === 'message')?.payload,
  ).toMatchObject({ occurredAt: 1234000 });

  expect(f.session.lastMessageAt).toBe(1234000);
});

it('steers only explicit immediate prompts into the exact active Codex turn without restarting it', async () => {
  const f = await fixture();

  const base = {
    version: 1 as const,
    sessionId: f.session.id,
    target: f.session.target,
    generation: f.session.generation,
    expiresAt: Date.now() + 15000,
  };

  expect(
    await f.dispatcher.dispatch({
      ...base,
      commandId: 'first',
      action: { type: 'prompt', text: 'Synthetic first' },
    }),
  ).toMatchObject({ status: 'dispatched' });

  expect(
    await f.dispatcher.dispatch({
      ...base,
      commandId: 'ordinary',
      action: { type: 'prompt', text: 'Synthetic ordinary' },
    }),
  ).toMatchObject({ status: 'rejected', code: 'SESSION_NOT_IDLE' });

  expect(
    await f.dispatcher.dispatch({
      ...base,
      commandId: 'immediate',
      action: { type: 'prompt', text: 'Synthetic immediate', delivery: 'immediate' },
    }),
  ).toMatchObject({ status: 'dispatched' });

  expect(f.rpc.calls.filter((call) => call.method === 'turn/steer')).toEqual([
    {
      method: 'turn/steer',
      params: {
        threadId: 'exact-thread',
        expectedTurnId: 'remote-turn',
        input: [{ type: 'text', text: 'Synthetic immediate' }],
      },
    },
  ]);

  expect(f.rpc.calls.filter((call) => call.method === 'turn/start')).toHaveLength(1);
  expect(f.rpc.calls.some((call) => call.method === 'turn/interrupt')).toBe(false);
  expect(f.session.status).toBe('running');
});

it('keeps an unexpected steering receipt unknown and never replays the native write', async () => {
  const f = await fixture();

  const base = {
    version: 1 as const,
    sessionId: f.session.id,
    target: f.session.target,
    generation: f.session.generation,
    expiresAt: Date.now() + 15000,
  };

  await f.dispatcher.dispatch({
    ...base,
    commandId: 'start',
    action: { type: 'prompt', text: 'Synthetic start' },
  });

  const request = f.rpc.request.bind(f.rpc);
  let steers = 0;

  f.rpc.request = async (method, params) => {
    if (method === 'turn/steer') {
      steers++;

      return { turnId: 'other-turn' };
    }

    return request(method, params);
  };

  const command = {
    ...base,
    commandId: 'uncertain-steering',
    action: { type: 'prompt' as const, text: 'Synthetic steering', delivery: 'immediate' as const },
  };

  expect(await f.dispatcher.dispatch(command)).toMatchObject({
    status: 'unknown',
    code: 'UNKNOWN_AFTER_WRITE',
  });

  expect(await f.dispatcher.dispatch(command)).toMatchObject({
    status: 'unknown',
    code: 'UNKNOWN_AFTER_WRITE',
  });

  expect(steers).toBe(1);
});
