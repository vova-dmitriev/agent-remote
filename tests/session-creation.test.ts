import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { AdapterRegistry, SourceAdapter } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { Dispatcher } from '../apps/daemon/src/commands/dispatcher.js';
import { noCapabilities, type Command } from '../packages/protocol/src/index.js';

const cleanup: (() => void)[] = [];

afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
);

function fixture() {
  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  cleanup.push(
    () => store.close(),
    () => permissions.close(),
  );

  adapters.register(
    new SourceAdapter({
      connectorId: 'native',
      kind: 'claude-code-cli',
      transport: 'hooks',
      sourceVersion: 'test',
      capabilities: { ...noCapabilities, observe: true, history: true },
      state: 'ready',
      reason: null,
    }),
  );

  const monitor = new Monitor({
    deviceId: 'device',
    store,
    adapters,
    permissions,
    allowSessionCreation: true,
  });

  monitor.ingestHook(
    { hook_event_name: 'SessionStart', session_id: 'parent', cwd: '/synthetic/project' },
    'native',
  );

  const source = monitor.snapshot().sessions[0]!;
  const created: string[] = [];

  const dispatcher = new Dispatcher({
    deviceId: 'device',
    store,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
    createSession: async (action) => {
      created.push(action.provider);

      return 'created-session';
    },
  });

  const command: Command = {
    version: 1,
    commandId: randomUUID(),
    target: source.target,
    sessionId: source.id,
    generation: source.generation,
    expiresAt: Date.now() + 15000,
    action: { type: 'create_session', provider: 'codex', cwd: '/synthetic/project' },
  };

  return { monitor, source, created, dispatcher, command };
}

it('creates once through a verified Mac context and retains the new session receipt for idempotent lookup', async () => {
  const f = fixture();

  expect(f.source.cwd).toBe('/synthetic/project');
  f.monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'parent' }, 'native');

  expect(await f.dispatcher.dispatch(f.command)).toMatchObject({
    status: 'dispatched',
    sessionId: 'created-session',
  });

  expect(await f.dispatcher.dispatch(f.command)).toMatchObject({
    status: 'dispatched',
    sessionId: 'created-session',
  });

  expect(f.created).toEqual(['codex']);
});

it('rejects a different directory and stale generation before any launch', async () => {
  const f = fixture();

  expect(
    await f.dispatcher.dispatch({
      ...f.command,
      action: { type: 'create_session', provider: 'claude', cwd: '/other' },
    }),
  ).toMatchObject({ status: 'rejected', code: 'INVALID_PROJECT' });

  expect(
    await f.dispatcher.dispatch({ ...f.command, commandId: randomUUID(), generation: 'stale' }),
  ).toMatchObject({ status: 'rejected', code: 'STALE_SESSION' });

  expect(f.created).toEqual([]);
});
