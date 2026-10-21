import { afterEach, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { Dispatcher } from '@daemon/commands/dispatcher.js';
import { bindCodex } from '@daemon/codex/binding/binding.js';
import { CodexRpcClient } from '@daemon/codex/rpc/rpc-client.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { CommandStatus, PromptDelivery, SessionStatus } from '@protocol';

const fixtures: (() => void)[] = [];

afterEach(() => fixtures.splice(0).forEach((cleanup) => cleanup()));

it('steers a running Codex CLI turn over JSON-RPC with its exact active turn ID', async () => {
  const sent: { method: string; params: Record<string, unknown> }[] = [];

  const { dispatcher, session, store, rpc, closePeer, boundClose } = await controlledCodex({
    onRequest: (frame, respond) => {
      sent.push({ method: frame.method, params: frame.params });

      if (typeof frame.id === 'number') {
        respond(frame.id, resultFor(frame.method));
      }
    },
  });

  const result = await dispatcher.dispatch({
    version: 1,
    commandId: 'immediate-send',
    target: session.target,
    sessionId: session.id,
    generation: session.generation,
    expiresAt: Date.now() + 15_000,
    action: { type: 'prompt', text: 'Follow up now', delivery: PromptDelivery.Immediate },
  });

  expect(result).toMatchObject({ status: CommandStatus.Dispatched });
  expect(session.status).toBe(SessionStatus.Running);

  expect(sent.filter(({ method }) => method === 'turn/steer')).toEqual([
    {
      method: 'turn/steer',
      params: {
        threadId: 'controlled-thread',
        expectedTurnId: 'busy-turn-7',
        input: [{ type: 'text', text: 'Follow up now' }],
      },
    },
  ]);

  expect(sent.filter(({ method }) => method === 'turn/start')).toHaveLength(0);

  boundClose();
  await rpc.close();
  closePeer();
  store.close();
});

it('keeps a lost steering acknowledgement unknown and does not repeat the RPC write', async () => {
  let steerWrites = 0;

  const { dispatcher, session, store, rpc, closePeer, boundClose } = await controlledCodex({
    timeoutMs: 25,
    onRequest: (frame, respond) => {
      if (frame.method === 'turn/steer') {
        steerWrites++;

        return;
      }

      if (typeof frame.id === 'number') {
        respond(frame.id, resultFor(frame.method));
      }
    },
  });

  const command = {
    version: 1 as const,
    commandId: 'lost-steer-ack',
    target: session.target,
    sessionId: session.id,
    generation: session.generation,
    expiresAt: Date.now() + 15_000,
    action: { type: 'prompt' as const, text: 'Never replay this write', delivery: PromptDelivery.Immediate },
  };

  expect(await dispatcher.dispatch(command)).toMatchObject({ status: CommandStatus.Unknown });
  expect(await dispatcher.dispatch(command)).toMatchObject({ status: CommandStatus.Unknown });
  expect(steerWrites).toBe(1);

  boundClose();
  await rpc.close();
  closePeer();
  store.close();
});

function resultFor(method: string) {
  if (method === 'thread/loaded/list') {
    return { data: ['controlled-thread'] };
  }

  if (method === 'thread/read') {
    return { thread: controlledThread() };
  }

  if (method === 'thread/resume') {
    return { thread: controlledThread(), model: 'gpt-controlled' };
  }

  if (method === 'thread/items/list') {
    return { data: [], nextCursor: null };
  }

  if (method === 'thread/turns/list') {
    return { data: [{ id: 'busy-turn-7', status: 'inProgress' }] };
  }

  if (method === 'turn/steer') {
    return { turnId: 'busy-turn-7' };
  }

  return {};
}

function controlledThread() {
  return {
    id: 'controlled-thread',
    name: 'Controlled thread',
    canAcceptDirectInput: true,
    status: { type: 'active' },
    turns: [{ id: 'busy-turn-7', status: 'inProgress' }],
  };
}

async function controlledCodex(options: {
  timeoutMs?: number;
  onRequest: (
    frame: { id?: number; method: string; params: Record<string, unknown> },
    respond: (id: number, result: unknown) => void,
  ) => void;
}) {
  const clientInput = new PassThrough();
  const clientOutput = new PassThrough();

  const rpc = new CodexRpcClient({
    input: clientInput,
    output: clientOutput,
    timeoutMs: options.timeoutMs ?? 1000,
  });

  const store = new LocalStore(':memory:', 'controlled-device');
  const permissions = new PermissionBroker();
  const adapters = new AdapterRegistry('controlled-device');
  const monitor = new Monitor({ deviceId: 'controlled-device', store, adapters, permissions });

  const dispatcher = new Dispatcher({
    deviceId: 'controlled-device',
    store,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  let buffer = '';

  clientInput.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');

    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');

      const frame = JSON.parse(buffer.slice(0, newline)) as {
        id?: number;
        method: string;
        params: Record<string, unknown>;
      };

      buffer = buffer.slice(newline + 1);
      options.onRequest(frame, (id, result) => clientOutput.write(JSON.stringify({ id, result }) + '\n'));
    }
  });

  const bound = await bindCodex(
    { kind: 'codex-cli', threadId: 'controlled-thread', endpoint: '/controlled/codex.sock' },
    { rpc, monitor, adapters, permissions, inputEnabled: true, permissionsEnabled: true },
  );

  fixtures.push(
    () => permissions.close(),
    () => bound.close(),
  );

  return {
    dispatcher,
    session: bound.session,
    store,
    rpc,
    boundClose: bound.close,
    closePeer: () => {
      clientInput.destroy();
      clientOutput.destroy();
    },
  };
}
