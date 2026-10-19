import { afterEach, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { UserInputBroker } from '../apps/daemon/src/commands/user-input-broker.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { AdapterRegistry } from '../apps/daemon/src/adapters/registry.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { Dispatcher } from '../apps/daemon/src/commands/dispatcher.js';
import { bindCodex } from '../apps/daemon/src/codex/binding/binding.js';
import type { RpcFrame } from '../apps/daemon/src/domain/codex/client.js';

const question = {
  id: 'q',
  header: 'Color',
  question: 'Pick a color',
  isOther: true,
  isSecret: false,
  options: [{ label: 'Blue', description: 'Color' }],
};

const frame: RpcFrame = {
  id: 7,
  method: 'item/tool/requestUserInput',
  params: { threadId: 'thread', turnId: 'turn', itemId: 'item', questions: [question] },
};

class Rpc extends EventEmitter {
  replies: unknown[] = [];
  pendingRequests() {
    return [frame];
  }
  async request(method: string): Promise<unknown> {
    if (method === 'thread/loaded/list') {
      return { data: ['thread'] };
    }

    if (method === 'thread/items/list') {
      return { data: [] };
    }

    return {
      thread: {
        id: 'thread',
        status: { type: 'active' },
        canAcceptDirectInput: true,
        turns: [{ id: 'turn', status: 'inProgress' }],
      },
    };
  }
  respond(id: string | number, result: unknown) {
    this.replies.push({ id, result });
  }
  async close() {}
}
const cleanup: (() => void)[] = [];

afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
);

async function fixture(configure?: (rpc: Rpc) => void) {
  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker(),
    userInputs = new UserInputBroker();

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions, userInputs });
  const rpc = new Rpc();

  configure?.(rpc);

  const bound = await bindCodex(
    { kind: 'codex-cli', threadId: 'thread', endpoint: '/synthetic' },
    { rpc, monitor, adapters, permissions, userInputs, inputEnabled: true, permissionsEnabled: true },
  );

  cleanup.push(
    () => store.close(),
    () => permissions.close(),
    () => userInputs.close(),
    bound.close,
  );

  const dispatcher = new Dispatcher({
    deviceId: 'device',
    store,
    adapters,
    permissions,
    userInputs,
    monitor,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  return { ...bound, rpc, userInputs, monitor, dispatcher };
}

it('hydrates structured questions and dispatches validated answers without prompt or approval conversion', async () => {
  const f = await fixture();

  expect(f.session.capabilities.userInput).toBe(true);
  const pending = f.monitor.snapshot().userInputs ?? [];

  expect(pending).toHaveLength(1);
  expect(f.session.status).toBe('waiting_input');

  const command = {
    version: 1 as const,
    commandId: 'answer',
    target: f.session.target,
    sessionId: f.session.id,
    generation: f.session.generation,
    expiresAt: Date.now() + 10000,
    action: {
      type: 'user_input' as const,
      requestId: pending[0]!.requestId,
      answers: { q: { answers: ['Blue'] } },
    },
  };

  expect((await f.dispatcher.dispatch(command)).status).toBe('dispatched');
  expect(f.rpc.replies).toEqual([{ id: 7, result: { answers: { q: { answers: ['Blue'] } } } }]);
  expect(f.userInputs.pending()).toEqual([]);

  expect((await f.dispatcher.dispatch({ ...command, commandId: 'duplicate' })).code).toBe(
    'USER_INPUT_EXPIRED',
  );
});

it('removes native resolved and superseded turn questions without sending an answer', async () => {
  const f = await fixture();

  f.rpc.emit('notification', {
    method: 'serverRequest/resolved',
    params: { threadId: 'thread', requestId: 7 },
  });

  expect(f.userInputs.pending()).toEqual([]);
  f.rpc.emit('request', { ...frame, id: 8 });
  expect(f.userInputs.pending()).toHaveLength(1);

  f.rpc.emit('notification', {
    method: 'turn/started',
    params: { threadId: 'thread', turn: { id: 'next' } },
  });

  expect(f.userInputs.pending()).toEqual([]);
  expect(f.rpc.replies).toEqual([]);
});

it('rejects obsolete source questions after source invalidation', async () => {
  const f = await fixture();

  f.monitor.invalidate(f.session.target.connectorId);
  expect(f.monitor.snapshot().userInputs).toEqual([]);
  expect(f.rpc.replies).toEqual([]);
});

it('CLI question response awaits the writable transport acknowledgement', async () => {
  const { Writable, PassThrough } = await import('node:stream');
  const { CodexRpcClient } = await import('../apps/daemon/src/codex/rpc/rpc-client.js');
  let acknowledge!: (error?: Error | null) => void;
  const sent: string[] = [];

  const input = new Writable({
    write(chunk, _encoding, callback) {
      sent.push(String(chunk));
      acknowledge = callback;
    },
  });

  const rpc = new CodexRpcClient({ input, output: new PassThrough() });
  let complete = false;

  const reply = Promise.resolve(rpc.respond('question', { answers: {} })).then(() => {
    complete = true;
  });

  await Promise.resolve();
  expect(complete).toBe(false);
  expect(sent).toEqual([JSON.stringify({ id: 'question', result: { answers: {} } }) + '\n']);
  acknowledge();
  await reply;
  expect(complete).toBe(true);
  await rpc.close();
});

it('does not resurrect a question resolved while initial history is hydrating', async () => {
  const f = await fixture((rpc) => {
    rpc.pendingRequests = () => [];
    const original = rpc.request.bind(rpc);

    rpc.request = async (method) => {
      if (method === 'thread/items/list') {
        rpc.emit('request', frame);

        rpc.emit('notification', {
          method: 'serverRequest/resolved',
          params: { threadId: 'thread', requestId: frame.id },
        });
      }

      return original(method);
    };
  });

  expect(f.userInputs.pending()).toEqual([]);
  expect(f.rpc.replies).toEqual([]);
});
