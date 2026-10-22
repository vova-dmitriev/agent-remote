import { afterEach, expect, it } from 'vitest';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { Dispatcher } from '@daemon/commands/dispatcher.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { AdapterRegistry, SourceAdapter, type TerminalInput } from '@daemon/adapters/registry.js';
import { actionSchema, CommandActionType, TerminalKey, type Command } from '@protocol';

const cleanups: (() => void)[] = [];

afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

function fixture(terminalInput: boolean) {
  const store = new LocalStore(':memory:', 'device');
  const permissions = new PermissionBroker();
  const typed: TerminalInput[] = [];
  const adapters = new AdapterRegistry('device');

  cleanups.push(
    () => store.close(),
    () => permissions.close(),
  );

  adapters.register(
    new SourceAdapter(
      {
        connectorId: 'managed',
        kind: 'claude-code-cli',
        transport: 'pty',
        sourceVersion: 'synthetic',
        capabilities: {
          observe: true,
          history: true,
          prompt: true,
          interrupt: true,
          permission: false,
          terminalSnapshot: true,
          terminalInput,
        },
        state: 'ready',
        reason: null,
      },
      { terminal: async (_binding, input) => void typed.push(input) },
    ),
  );

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'native' }, 'managed');
  const session = monitor.session(monitor.snapshot().sessions[0]!.id)!;

  const dispatcher = new Dispatcher({
    deviceId: 'device',
    store,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
  });

  const command = (action: Command['action']): Command => ({
    version: 1,
    commandId: crypto.randomUUID(),
    sessionId: session.id,
    target: session.target,
    generation: session.generation,
    expiresAt: Date.now() + 15000,
    action,
  });

  return { dispatcher, typed, command };
}

it('accepts typed text and a key, never control characters or an empty input', () => {
  expect(
    actionSchema.safeParse({ type: CommandActionType.TerminalInput, text: 'ls', key: TerminalKey.Enter })
      .success,
  ).toBe(true);

  expect(
    actionSchema.safeParse({ type: CommandActionType.TerminalInput, key: TerminalKey.Interrupt }).success,
  ).toBe(true);

  expect(
    actionSchema.safeParse({ type: CommandActionType.TerminalInput, text: 'rm\u001b[201~' }).success,
  ).toBe(false);

  expect(actionSchema.safeParse({ type: CommandActionType.TerminalInput }).success).toBe(false);
});

it('types into a terminal that takes input and refuses one that does not', async () => {
  const open = fixture(true);

  const sent = await open.dispatcher.dispatch(
    open.command({ type: CommandActionType.TerminalInput, text: 'ls', key: TerminalKey.Enter }),
  );

  expect(sent.status).toBe('dispatched');
  expect(open.typed).toEqual([{ text: 'ls', key: TerminalKey.Enter }]);

  const closed = fixture(false);

  const refused = await closed.dispatcher.dispatch(
    closed.command({ type: CommandActionType.TerminalInput, key: TerminalKey.Enter }),
  );

  expect(refused).toMatchObject({ status: 'rejected', code: 'CAPABILITY_UNAVAILABLE' });
  expect(closed.typed).toEqual([]);
});
