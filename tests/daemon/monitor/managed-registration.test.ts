import { expect, it } from 'vitest';
import { LocalStore } from '../../../apps/daemon/src/monitor/store.js';
import { Monitor } from '../../../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry, SourceAdapter } from '../../../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../../../apps/daemon/src/commands/permission-broker.js';
import { noCapabilities } from '@protocol';

it('restores the same owned managed conversation after daemon restart with a fresh input binding', () => {
  const store = new LocalStore(':memory:', 'device'),
    permissions = new PermissionBroker();

  const adapters = new AdapterRegistry('device');

  adapters.register(
    new SourceAdapter({
      connectorId: 'wrapper',
      kind: 'claude-code-cli',
      transport: 'pty',
      sourceVersion: 'synthetic',
      state: 'ready',
      reason: null,
      capabilities: { ...noCapabilities, observe: true, history: true, prompt: true },
    }),
  );

  try {
    const first = new Monitor({ deviceId: 'device', store, adapters, permissions });

    first.ingestHook(
      {
        hook_event_name: 'SessionStart',
        session_id: 'original',
        cwd: '/synthetic',
        transcript_path: '/synthetic/source.jsonl',
      },
      'wrapper',
    );

    const original = first.snapshot().sessions[0]!;

    first.setSessionTitle(original.id, 'Kept title');
    const next = new Monitor({ deviceId: 'device', store, adapters, permissions });

    expect(next.snapshot().sessions).toHaveLength(0);
    const saved = next.managedRegistration('wrapper');

    expect(saved?.transcriptPath).toBe('/synthetic/source.jsonl');
    next.restoreManaged(saved!.session);
    const restored = next.snapshot().sessions[0]!;

    expect(restored.id).toBe(original.id);
    expect(restored.title).toBe('Kept title');
    expect(restored.generation).not.toBe(original.generation);
    expect(restored.capabilities.prompt).toBe(true);
    expect(next.binding(restored.id)?.generation).toBe(restored.generation);
    expect(next.managedRegistration('foreign')).toBeUndefined();
  } finally {
    permissions.close();
    store.close();
  }
});
