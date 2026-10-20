import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Monitor } from '@daemon/monitor/monitor.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { AdapterRegistry, SourceAdapter } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { Dispatcher } from '@daemon/commands/dispatcher.js';
import { noCapabilities, type Command } from '@protocol';

for (const transport of ['pty', 'cmux'] as const) {
  it(
    'resumes an unbound restored native session exactly once through ' +
      transport +
      ' with the same remote identity and a fresh input binding',
    async () => {
      const store = new LocalStore(':memory:', 'device'),
        adapters = new AdapterRegistry('device'),
        permissions = new PermissionBroker();

      try {
        const descriptor = {
          kind: 'claude-code-cli' as const,
          sourceVersion: 'synthetic',
          state: 'ready' as const,
          reason: null,
        };

        adapters.register(
          new SourceAdapter({
            ...descriptor,
            connectorId: 'native',
            transport: 'hooks',
            capabilities: { ...noCapabilities, history: true, observe: true },
          }),
        );

        const original = new Monitor({ deviceId: 'device', store, adapters, permissions });

        original.ingestHook(
          { hook_event_name: 'SessionStart', session_id: 'native-original', cwd: '/synthetic/project' },
          'native',
        );

        const source = original.snapshot().sessions[0]!;

        original.setSessionTitle(source.id, 'Original title');
        const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });
        const restored = monitor.snapshot().sessions[0]!;

        expect(monitor.binding(restored.id)).toBeUndefined();
        monitor.setNativeRestartState(restored.id, restored.generation, 'available');

        adapters.register(
          new SourceAdapter({
            ...descriptor,
            kind: transport === 'cmux' ? 'cmux' : 'claude-code-cli',
            connectorId: 'wrapper',
            transport,
            capabilities: { ...noCapabilities, history: true, observe: true, prompt: true },
          }),
        );

        let restarts = 0;

        const dispatcher = new Dispatcher({
          deviceId: 'device',
          store,
          monitor,
          adapters,
          permissions,
          inputEnabled: true,
          permissionsEnabled: false,
          restartSession: async (session) => {
            restarts++;
            monitor.markNativeStopped(session.id, session.generation);

            monitor.ingestHook(
              { hook_event_name: 'SessionStart', session_id: 'native-original', cwd: '/synthetic/project' },
              'wrapper',
              transport === 'cmux'
                ? {
                    kind: 'cmux',
                    deviceId: 'device',
                    connectorId: 'wrapper',
                    windowId: '11111111-1111-4111-8111-111111111111',
                    workspaceId: '22222222-2222-4222-8222-222222222222',
                    surfaceId: '33333333-3333-4333-8333-333333333333',
                  }
                : undefined,
            );

            return session.id;
          },
        });

        const command: Command = {
          version: 1,
          commandId: randomUUID(),
          target: restored.target,
          sessionId: restored.id,
          generation: restored.generation,
          expiresAt: Date.now() + 15000,
          action: { type: 'restart_session' },
        };

        expect(
          await dispatcher.dispatch({ ...command, commandId: randomUUID(), generation: 'stale' }),
        ).toMatchObject({ status: 'rejected', code: 'STALE_SESSION' });

        expect(restarts).toBe(0);

        expect(await dispatcher.dispatch(command)).toMatchObject({
          status: 'dispatched',
          sessionId: source.id,
        });

        expect(await dispatcher.dispatch(command)).toMatchObject({
          status: 'dispatched',
          sessionId: source.id,
        });

        expect(restarts).toBe(1);
        expect(monitor.snapshot().sessions).toHaveLength(1);
        const resumed = monitor.snapshot().sessions[0]!;

        expect(resumed).toMatchObject({
          id: source.id,
          claudeSessionId: 'native-original',
          target: { connectorId: 'wrapper' },
          capabilities: { prompt: true },
          binding: 'verified',
          integrationState: 'ready',
        });

        expect(resumed.generation).not.toBe(restored.generation);
        expect(monitor.binding(resumed.id)?.generation).toBe(resumed.generation);
        expect(store.nativeSessions()).toHaveLength(0);

        expect(
          monitor.ingestHook({ hook_event_name: 'SessionEnd', session_id: 'native-original' }, 'native'),
        ).toEqual([]);

        expect(monitor.snapshot().sessions).toHaveLength(1);
        expect(monitor.snapshot().sessions[0]!.capabilities.prompt).toBe(true);
      } finally {
        permissions.close();
        store.close();
      }
    },
  );
}
