import { expect, it } from 'vitest';
import { localFixture } from '../../helpers/local/local-runtime.js';
import { MAX_DEVICE_SESSIONS } from '@protocol';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { registerNativeAdapter } from '@daemon/runtime/wiring/native-adapter.js';

it('marks a session the owner created from the app once, so the lists can order it before its first message', async () => {
  const f = localFixture();

  try {
    f.monitor.markCreated(f.session.id, 1_000);
    f.monitor.markCreated(f.session.id, 2_000);
    f.monitor.markCreated('missing-session', 3_000);

    expect(f.monitor.snapshot().sessions.find((session) => session.id === f.session.id)?.createdAt).toBe(
      1_000,
    );
  } finally {
    await f.close();
  }
});

it('finds a session just started, without messages yet, though the snapshot lists only the newest ones', () => {
  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  registerNativeAdapter(adapters, false);

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  try {
    // A full snapshot of sessions with messages, then one that has none yet.
    for (let index = 0; index <= MAX_DEVICE_SESSIONS; index++) {
      monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'older-' + index }, 'native');
      const session = monitor.findClaude('native', 'older-' + index)!;

      monitor.setSessionActivity(session.id, session.generation, 1_000 + index);
    }

    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'just-started' }, 'native');

    const fresh = (session: { claudeSessionId?: string | null }) =>
      session.claudeSessionId === 'just-started';

    expect(monitor.snapshot().sessions.some(fresh)).toBe(false);
    expect(monitor.find(fresh)?.claudeSessionId).toBe('just-started');
  } finally {
    permissions.close();
    store.close();
  }
});
