import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { bindCodex } from '../../../../apps/daemon/src/codex/binding/binding.js';
import { LocalStore } from '../../../../apps/daemon/src/monitor/store.js';
import { Monitor } from '../../../../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../../../../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../../../../apps/daemon/src/commands/permission-broker.js';

const edit = (id: string, path = 'src/synthetic.ts') => ({
  id,
  type: 'fileChange',
  status: 'completed',
  changes: [{ path, kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-const count = 1;\n+const count = 2;' }],
});

class Rpc extends EventEmitter {
  async request(method: string) {
    if (method === 'thread/loaded/list') {
      return { data: ['owned-thread'] };
    }

    if (method === 'thread/read' || method === 'thread/resume') {
      return { thread: { id: 'owned-thread', status: { type: 'idle' }, turns: [] } };
    }

    if (method === 'thread/items/list') {
      return { data: [{ turnId: 'history', item: edit('hydrated') }] };
    }

    return {};
  }
  respond() {}
  async close() {}
}

it('hydrates and streams native edits only for the exact bound thread; closes without accepting more patches', async () => {
  const rpc = new Rpc();
  const store = new LocalStore(':memory:', 'device');
  const adapters = new AdapterRegistry('device');
  const permissions = new PermissionBroker();
  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  const binding = await bindCodex(
    { kind: 'codex-desktop', endpoint: 'synthetic', threadId: 'owned-thread' },
    { rpc, monitor, adapters, permissions, inputEnabled: false, permissionsEnabled: false },
  );

  try {
    expect(monitor.snapshot().sessions[0]?.changes?.files).toHaveLength(1);

    rpc.emit('notification', {
      method: 'item/completed',
      params: { threadId: 'other-thread', turnId: 'other', item: edit('other', 'other-secret.ts') },
    });

    expect(JSON.stringify(monitor.snapshot())).not.toContain('other-secret');

    rpc.emit('notification', {
      method: 'item/completed',
      params: { threadId: 'owned-thread', turnId: 'live', item: edit('live') },
    });

    expect(monitor.snapshot().sessions[0]?.changes?.files).toHaveLength(2);
    expect(monitor.snapshot().sessions[0]?.changes?.files[1]?.patch).toContain('+const count = 2;');
    binding.close();

    rpc.emit('notification', {
      method: 'item/completed',
      params: { threadId: 'owned-thread', turnId: 'late', item: edit('late') },
    });

    expect(monitor.snapshot().sessions[0]?.changes?.files).toHaveLength(2);
  } finally {
    binding.close();
    permissions.close();
    store.close();
  }
});
