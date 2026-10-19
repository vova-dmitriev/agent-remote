import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { Dispatcher } from '../apps/daemon/src/commands/dispatcher.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { SourceAdapter, AdapterRegistry } from '../apps/daemon/src/adapters/registry.js';
import type { Command } from '@protocol';

const attachment = {
  id: 'a',
  name: 'one.txt',
  byteLength: 3,
  sha256: createHash('sha256').update('one').digest('hex'),
  kind: 'file' as const,
  mimeType: 'text/plain',
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  vi.restoreAllMocks();

  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

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
      sourceVersion: 'test',
      capabilities: {
        observe: true,
        history: true,
        prompt: true,
        interrupt: true,
        permission: false,
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

  monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 's' }, 'managed');
  const session = monitor.snapshot().sessions[0]!;
  let resolve!: (value: { descriptor: typeof attachment; path: string }[]) => void;
  let started!: () => void;
  const starting = new Promise<void>((r) => (started = r));
  const preparing = new Promise<{ descriptor: typeof attachment; path: string }[]>((r) => (resolve = r));

  const dispatcher = new Dispatcher({
    deviceId: 'device',
    store,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
    prepareAttachments: async () => {
      started();

      return preparing;
    },
  });

  const command: Command = {
    version: 1,
    commandId: 'one',
    sessionId: session.id,
    generation: session.generation,
    target: session.target,
    expiresAt: Date.now() + 15000,
    action: { type: 'prompt', text: '', attachments: [attachment] },
  };

  return { dispatcher, monitor, command, deliveries, starting, resolve };
}

describe('attachment preparation before source effects', () => {
  for (const race of ['disconnect', 'generation', 'busy', 'expiry'] as const) {
    it(`fences ${race} while downloading`, async () => {
      const f = fixture();
      const pending = f.dispatcher.dispatch(f.command);

      await f.starting;

      if (race === 'disconnect') {
        f.dispatcher.setConnection(false);
        f.dispatcher.setConnection(true);
      }

      if (race === 'generation') {
        f.monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 's' }, 'managed');
      }

      if (race === 'busy') {
        f.monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 's' }, 'managed');
      }

      if (race === 'expiry') {
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_001);
      }

      f.resolve([{ descriptor: attachment, path: '/private/one' }]);
      const result = await pending;

      expect(result.status).toBe('rejected');
      expect(f.deliveries).toHaveLength(0);
    });
  }

  it('passes prepared descriptors once and preserves durable dedup', async () => {
    const f = fixture();
    const pending = f.dispatcher.dispatch(f.command);

    await f.starting;
    f.resolve([{ descriptor: attachment, path: '/private/one' }]);
    expect((await pending).status).toBe('dispatched');
    expect(f.deliveries[0]?.[2]).toEqual([{ descriptor: attachment, path: '/private/one' }]);
    expect((await f.dispatcher.dispatch(f.command)).status).toBe('dispatched');
    expect(f.deliveries).toHaveLength(1);
  });
});

it('removes upload capabilities from ended or unverified Claude sources', () => {
  const f = fixture();

  f.monitor.ingestHook({ hook_event_name: 'SessionEnd', session_id: 's' }, 'managed');
  expect(f.monitor.session(f.command.sessionId)?.capabilities.attachments).toBeUndefined();
  f.monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'unverified' }, 'managed');
  expect(f.monitor.findClaude('managed', 'unverified')?.capabilities.attachments).toBeUndefined();
});
