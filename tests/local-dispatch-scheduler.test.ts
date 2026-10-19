import { afterEach, expect, it, vi } from 'vitest';
import { CommandActionType, CommandStatus } from '@protocol';
import { Dispatcher } from '../apps/daemon/src/commands/dispatcher.js';
import { DispatchScheduler } from '../apps/daemon/src/commands/scheduling/index.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { localFixture } from './helpers/local-runtime.js';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanups.splice(0)) {
    await close();
  }
});

it('serializes different relay and local commands with independent connection fences', async () => {
  const f = localFixture();
  const permissions = new PermissionBroker();
  const scheduler = new DispatchScheduler();

  const options = {
    deviceId: f.session.target.deviceId,
    store: f.store,
    monitor: f.monitor,
    adapters: f.controller.options.adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
    scheduler,
  };

  const relay = new Dispatcher(options);
  const local = new Dispatcher(options);
  const entered: string[] = [];
  let release!: () => void;

  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  cleanups.push(async () => {
    release();
    await Promise.all([relay.drain(), local.drain()]);
    permissions.close();
    await f.close();
  });

  vi.spyOn(options.adapters.resolve(f.session.target), 'sendPrompt').mockImplementation(
    async (_binding, text) => {
      entered.push(text);

      if (text === 'relay') {
        await blocked;
      }

      return { status: CommandStatus.Dispatched };
    },
  );

  const command = (text: string) =>
    f.store.localCommand({
      commandId: text,
      target: f.session.target,
      sessionId: f.session.id,
      generation: f.session.generation,
      action: { type: CommandActionType.Prompt, text },
    });

  const first = relay.dispatch(command('relay'));

  await vi.waitFor(() => expect(entered).toEqual(['relay']));
  const second = local.dispatch(command('local'));

  await new Promise(setImmediate);
  expect(entered).toEqual(['relay']);
  relay.setConnection(false);
  release();
  expect(await first).toMatchObject({ status: CommandStatus.Dispatched });
  expect(await second).toMatchObject({ status: CommandStatus.Dispatched });
  expect(entered).toEqual(['relay', 'local']);
});
