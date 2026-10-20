import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { bindCodex } from '../../../../apps/daemon/src/codex/binding/binding.js';
import { LocalStore } from '../../../../apps/daemon/src/monitor/store.js';
import { Monitor } from '../../../../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../../../../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../../../../apps/daemon/src/commands/permission-broker.js';

class Rpc extends EventEmitter {
  active = false;
  async request(method: string) {
    if (method === 'thread/loaded/list') {
      return { data: ['thread'] };
    }

    if (method === 'thread/read' || method === 'thread/resume') {
      return {
        thread: {
          id: 'thread',
          status: { type: this.active ? 'active' : 'idle' },
          turns: this.active ? [{ id: 'hydrated', status: 'inProgress', items: [] }] : [],
        },
      };
    }

    if (method === 'thread/items/list') {
      return {
        data: this.active
          ? [{ turnId: 'hydrated', item: { id: 'existing', type: 'commandExecution', status: 'inProgress' } }]
          : [],
      };
    }

    if (method === 'thread/turns/list') {
      return { data: [] };
    }

    return {};
  }
  respond() {}
  async close() {}
}

it('tracks active Codex tools without exposing commands or reasoning and fences old turns', async () => {
  const rpc = new Rpc(),
    store = new LocalStore(':memory:', 'device'),
    permissions = new PermissionBroker();

  const monitor = new Monitor({
    deviceId: 'device',
    store,
    adapters: new AdapterRegistry('device'),
    permissions,
  });

  const binding = await bindCodex(
    { kind: 'codex-cli', threadId: 'thread', endpoint: 'synthetic' },
    {
      rpc,
      monitor,
      adapters: new AdapterRegistry('device'),
      permissions,
      inputEnabled: false,
      permissionsEnabled: false,
    },
  );

  const notify = (method: string, params: object) =>
    rpc.emit('notification', { method, params: { threadId: 'thread', ...params } });

  try {
    notify('turn/started', { turn: { id: 'turn' } });

    notify('item/started', {
      turnId: 'turn',
      item: { id: 'command', type: 'commandExecution', command: 'private-token', title: 'private-title' },
    });

    expect(binding.session.currentActivity).toMatchObject({ id: 'command', kind: 'command' });
    expect(JSON.stringify(monitor.snapshot())).not.toContain('private');
    notify('item/started', { turnId: 'old', item: { id: 'old', type: 'fileChange' } });
    expect(binding.session.currentActivity?.id).toBe('command');
    notify('item/completed', { turnId: 'old', item: { id: 'command', type: 'commandExecution' } });
    expect(binding.session.currentActivity).toBeDefined();
    notify('item/completed', { turnId: 'turn', item: { id: 'command', type: 'commandExecution' } });
    expect(binding.session.currentActivity).toBeUndefined();

    notify('item/started', {
      turnId: 'turn',
      item: { id: 'reasoning', type: 'reasoning', text: 'private reasoning' },
    });

    expect(binding.session.currentActivity).toBeUndefined();
    notify('item/started', { turnId: 'turn', item: { id: 'file', type: 'fileChange' } });
    expect(binding.session.currentActivity?.kind).toBe('write');
    notify('turn/completed', { turn: { id: 'turn', status: 'completed' } });
    expect(binding.session.currentActivity).toBeUndefined();
  } finally {
    binding.close();
    permissions.close();
    store.close();
  }
});

it('recovers an already executing tool on attach without replaying completed tool history', async () => {
  const rpc = new Rpc(),
    store = new LocalStore(':memory:', 'device'),
    permissions = new PermissionBroker(),
    adapters = new AdapterRegistry('device');

  rpc.active = true;
  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  const binding = await bindCodex(
    { kind: 'codex-cli', threadId: 'thread', endpoint: 'synthetic' },
    { rpc, monitor, adapters, permissions, inputEnabled: false, permissionsEnabled: false },
  );

  try {
    expect(binding.session.currentActivity).toMatchObject({ id: 'existing', kind: 'command' });
  } finally {
    binding.close();
    permissions.close();
    store.close();
  }
});
