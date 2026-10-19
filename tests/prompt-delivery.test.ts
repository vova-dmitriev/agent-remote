import { afterEach, expect, it } from 'vitest';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { Dispatcher } from '../apps/daemon/src/commands/dispatcher.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { AdapterRegistry, SourceAdapter } from '../apps/daemon/src/adapters/registry.js';
import { actionSchema, type Command, type Session } from '@protocol';

const cleanups: (() => void)[] = [];

afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

function fixture() {
  const store = new LocalStore(':memory:', 'device');
  const permissions = new PermissionBroker();

  cleanups.push(
    () => store.close(),
    () => permissions.close(),
  );

  const adapters = new AdapterRegistry('device');
  const deliveries: unknown[][] = [];

  const adapter = new SourceAdapter(
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
        permission: true,
        terminalSnapshot: false,
        attachments: { images: 'reference', files: 'reference' },
      },
      state: 'ready',
      reason: null,
    },
    {
      prompt: async (...args) => {
        deliveries.push(args);

        return { status: 'dispatched' };
      },
    },
  );

  adapters.register(adapter);
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
    permissionsEnabled: true,
  });

  const command = (delivery?: string): Command =>
    ({
      version: 1,
      commandId: crypto.randomUUID(),
      sessionId: session.id,
      target: session.target,
      generation: session.generation,
      expiresAt: Date.now() + 15000,
      action: { type: 'prompt', text: 'Synthetic queued follow-up', ...(delivery ? { delivery } : {}) },
    }) as Command;

  return { dispatcher, session, deliveries, command, monitor, store, adapters, permissions };
}

it('preserves absent delivery and validates explicit prompt delivery modes', () => {
  expect(actionSchema.parse({ type: 'prompt', text: 'Synthetic' })).toEqual({
    type: 'prompt',
    text: 'Synthetic',
  });

  expect(actionSchema.safeParse({ type: 'prompt', text: 'Synthetic', delivery: 'immediate' }).success).toBe(
    true,
  );

  expect(actionSchema.safeParse({ type: 'prompt', text: 'Synthetic', delivery: 'when_idle' }).success).toBe(
    true,
  );

  expect(actionSchema.safeParse({ type: 'prompt', text: 'Synthetic', delivery: 'invalid' }).success).toBe(
    false,
  );
});

it('rejects ordinary busy prompts but dispatches explicit immediate input exactly once', async () => {
  const f = fixture();

  f.session.status = 'running';

  expect(await f.dispatcher.dispatch(f.command())).toMatchObject({
    status: 'rejected',
    code: 'SESSION_NOT_IDLE',
  });

  const immediate = f.command('immediate');

  expect(await f.dispatcher.dispatch(immediate)).toMatchObject({ status: 'dispatched' });
  expect(await f.dispatcher.dispatch(immediate)).toMatchObject({ status: 'dispatched' });
  expect(f.deliveries).toHaveLength(1);
  expect(f.deliveries[0]![3]).toBe('immediate');
  expect(f.session.status).toBe('running');
});

for (const status of ['waiting_permission', 'waiting_input', 'ended', 'unknown'] as Session['status'][]) {
  it(`never sends immediate input while ${status}`, async () => {
    const f = fixture();

    f.session.status = status;

    expect(await f.dispatcher.dispatch(f.command('immediate'))).toMatchObject({
      status: 'rejected',
      code: 'SESSION_NOT_IDLE',
    });

    expect(f.deliveries).toHaveLength(0);
  });
}

it('keeps stale generation fencing for immediate input', async () => {
  const f = fixture();

  f.session.status = 'running';

  expect(await f.dispatcher.dispatch({ ...f.command('immediate'), generation: 'stale' })).toMatchObject({
    status: 'rejected',
    code: 'STALE_SESSION',
  });

  expect(f.deliveries).toHaveLength(0);
});

for (const phase of ['download', 'record'] as const) {
  for (const blocked of ['waiting_input', 'stale'] as const) {
    it(`fences immediate input after attachment ${phase} changes to ${blocked}`, async () => {
      const f = fixture();

      f.session.status = 'running';

      const attachment = {
        id: 'a',
        name: 'synthetic.txt',
        byteLength: 1,
        sha256: 'a'.repeat(64),
        kind: 'file' as const,
        mimeType: 'text/plain',
      };

      let release!: () => void;
      let started!: () => void;

      const boundary = new Promise<void>((resolve) => {
        release = resolve;
      });

      const beginning = new Promise<void>((resolve) => {
        started = resolve;
      });

      const pause = async () => {
        started();
        await boundary;
      };

      const dispatcher = new Dispatcher({
        deviceId: 'device',
        store: f.store,
        monitor: f.monitor,
        adapters: f.adapters,
        permissions: f.permissions,
        inputEnabled: true,
        permissionsEnabled: true,
        prepareAttachments: async () => {
          if (phase === 'download') {
            await pause();
          }

          return [{ descriptor: attachment, path: '/synthetic/attachment' }];
        },
        recordAttachments: async () => {
          if (phase === 'record') {
            await pause();
          }
        },
      });

      const command = f.command('immediate');

      if (command.action.type !== 'prompt') {
        throw new Error('Invalid fixture');
      }

      command.action.attachments = [attachment];
      const pending = dispatcher.dispatch(command);

      await beginning;

      if (blocked === 'stale') {
        f.session.generation = 'changed';
      } else {
        f.session.status = 'waiting_input';
      }

      release();

      expect(await pending).toMatchObject({
        status: 'rejected',
        code: blocked === 'stale' ? 'STALE_SESSION' : 'SESSION_NOT_IDLE',
      });

      expect(f.deliveries).toHaveLength(0);
    });
  }
}

it('keeps idle delivery compatible for absent and explicit modes', async () => {
  const f = fixture();

  f.session.status = 'idle';

  for (const mode of [undefined, 'when_idle', 'immediate']) {
    expect(await f.dispatcher.dispatch(f.command(mode))).toMatchObject({ status: 'dispatched' });
  }

  expect(f.deliveries).toHaveLength(3);
});

it('passes immediate attachments through both awaits while the session remains running', async () => {
  const f = fixture();

  f.session.status = 'running';

  const attachment = {
    id: 'a',
    name: 'synthetic.txt',
    byteLength: 1,
    sha256: 'a'.repeat(64),
    kind: 'file' as const,
    mimeType: 'text/plain',
  };

  const recorded: string[] = [];

  const dispatcher = new Dispatcher({
    deviceId: 'device',
    store: f.store,
    monitor: f.monitor,
    adapters: f.adapters,
    permissions: f.permissions,
    inputEnabled: true,
    permissionsEnabled: true,
    prepareAttachments: async () => [{ descriptor: attachment, path: '/synthetic/attachment' }],
    recordAttachments: async (_session, text) => {
      recorded.push(text);
    },
  });

  const command = f.command('immediate');

  if (command.action.type !== 'prompt') {
    throw new Error('Invalid fixture');
  }

  command.action.attachments = [attachment];
  expect(await dispatcher.dispatch(command)).toMatchObject({ status: 'dispatched' });
  expect(recorded).toEqual(['Synthetic queued follow-up']);

  expect(f.deliveries[0]!.slice(1)).toEqual([
    'Synthetic queued follow-up',
    [{ descriptor: attachment, path: '/synthetic/attachment' }],
    'immediate',
  ]);
});
