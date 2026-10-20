import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { bindCodex } from '../../../apps/daemon/src/codex/binding/binding.js';
import { LocalStore } from '../../../apps/daemon/src/monitor/store.js';
import { Monitor } from '../../../apps/daemon/src/monitor/monitor.js';
import { PermissionBroker } from '../../../apps/daemon/src/commands/permission-broker.js';
import { AdapterRegistry } from '../../../apps/daemon/src/adapters/registry.js';
import type { AttachmentService } from '../../../apps/daemon/src/attachments/service.js';
import type { HistoryMessage } from '@protocol';

const cleanups: (() => void)[] = [];

afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

async function fixture(historyCount = 0) {
  const rpc = new EventEmitter() as EventEmitter & {
    request: (method: string) => Promise<unknown>;
    respond: () => void;
    close: () => Promise<void>;
  };

  rpc.request = async (method) => {
    if (method === 'thread/loaded/list') {
      return { data: ['t'] };
    }

    if (method === 'thread/items/list') {
      return {
        data: Array.from({ length: historyCount }, (_, index) => ({
          turnId: 'history',
          item: { id: `text-${index}`, type: 'agentMessage', text: `History ${index}` },
        })),
        nextCursor: null,
      };
    }

    return { thread: { id: 't', canAcceptDirectInput: true, status: { type: 'idle' }, turns: [] } };
  };

  rpc.respond = () => {};

  rpc.close = async () => {};

  const store = new LocalStore(':memory:', 'd');

  const adapters = new AdapterRegistry('d'),
    permissions = new PermissionBroker();

  const monitor = new Monitor({ deviceId: 'd', store, adapters, permissions });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));

  const normalize = vi.fn(async (_session: unknown, message: HistoryMessage) => {
    await blocked;

    return message;
  });

  const attachments = {
    ready: async () => {},
    restore: (_session: unknown, message: HistoryMessage) => message,
    normalize,
  } as unknown as AttachmentService;

  const binding = await bindCodex({ kind: 'codex-desktop', threadId: 't', endpoint: '/private/synthetic' }, {
    rpc,
    monitor,
    store,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
    attachments,
  } as Parameters<typeof bindCodex>[1]);

  cleanups.push(() => {
    binding.close();
    permissions.close();
    store.close();
  });

  const image = 'data:image/png;base64,' + Buffer.alloc(4 * 1024 * 1024, 1).toString('base64');

  const notify = (id: string) =>
    rpc.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 't',
        turnId: 'turn',
        item: { id, type: 'userMessage', content: [{ type: 'image', url: image }] },
      },
    });

  return { ...binding, normalize, release, notify, store };
}

it('coalesces repeated Desktop snapshots and drops queued exports when the binding closes', async () => {
  const f = await fixture();

  for (let index = 0; index < 100; index++) {
    f.notify('same-image');
  }

  expect(f.normalize).toHaveBeenCalledTimes(1);
  f.close();
  f.release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.normalize).toHaveBeenCalledTimes(1);
});

it('bounds pending encoded media bytes while source exports are blocked', async () => {
  const f = await fixture();

  for (let index = 0; index < 20; index++) {
    f.notify(`image-${index}`);
  }

  expect(f.normalize).toHaveBeenCalledTimes(1);
  f.release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.normalize.mock.calls.length).toBeLessThanOrEqual(7);
});

it('preserves five hundred ordinary history messages with an attachment service installed', async () => {
  const f = await fixture(500);
  const events = f.store.replay({ ...f.store.cursor(), seq: 0 });

  expect(events !== 'resync_required' && events.filter((event) => event.type === 'message')).toHaveLength(
    500,
  );

  expect(f.normalize).not.toHaveBeenCalled();
});
