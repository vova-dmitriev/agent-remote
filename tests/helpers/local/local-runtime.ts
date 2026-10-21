import { AttachmentMode, CommandStatus, ConnectorTransport, IntegrationState, TargetKind } from '@protocol';
import { ClaudeHookEvent } from '@daemon/domain/claude.js';
import { randomUUID } from 'node:crypto';
import { AdapterRegistry, SourceAdapter } from '@daemon/adapters/registry.js';
import { Dispatcher } from '@daemon/commands/dispatcher.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { LocalDatabase } from '@daemon/local/state/database.js';
import { LocalGrants } from '@daemon/local/grants/service.js';
import { LocalController } from '@daemon/local/controller/controller.js';
import type { LocalControllerOptions } from '@daemon/local/controller/types.js';
import { LocalMediaRepository } from '@daemon/local/media/repository.js';
import { LocalDocuments } from '@daemon/local/state/documents.js';

export const localTestOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

export function localFixture(
  directory?: string,
  profiles?: LocalControllerOptions['profiles'],
  names?: LocalControllerOptions['names'],
  analytics?: LocalControllerOptions['analytics'],
) {
  const store = new LocalStore(':memory:', 'device-local');
  const database = new LocalDatabase(':memory:');
  const permissions = new PermissionBroker();
  const adapters = new AdapterRegistry('device-local');
  const delivered: string[] = [];

  adapters.register(
    new SourceAdapter(
      {
        connectorId: 'managed-test',
        kind: TargetKind.ClaudeCodeCli,
        transport: ConnectorTransport.Pty,
        sourceVersion: 'synthetic',
        capabilities: {
          observe: true,
          history: true,
          prompt: true,
          interrupt: true,
          permission: false,
          terminalSnapshot: false,
          ...(directory
            ? { attachments: { images: AttachmentMode.Native, files: AttachmentMode.Reference } }
            : {}),
        },
        state: IntegrationState.Ready,
        reason: null,
      },
      {
        prompt: async (_binding, text) => {
          delivered.push(text);

          return { status: CommandStatus.Dispatched };
        },
      },
    ),
  );

  const monitor = new Monitor({ deviceId: 'device-local', store, adapters, permissions });

  monitor.ingestHook(
    { hook_event_name: ClaudeHookEvent.SessionStart, session_id: 'synthetic-session' },
    'managed-test',
  );

  const session = monitor.snapshot().sessions[0]!;
  const grants = new LocalGrants(database, 'owner-local', 'device-local', [localTestOrigin]);

  const dispatcher = new Dispatcher({
    deviceId: 'device-local',
    monitor,
    store,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
  });

  const documents = new LocalDocuments(database);

  const media = directory
    ? new LocalMediaRepository({
        directory,
        database,
        ownerId: 'owner-local',
        session: (id) => monitor.session(id),
        current: (principal) => grants.current(principal),
      })
    : undefined;

  const controller = new LocalController({
    ...(media ? { media } : {}),
    ...(profiles ? { profiles } : {}),
    ...(names ? { names } : {}),
    analytics,
    ownerId: 'owner-local',
    deviceId: 'device-local',
    monitor,
    store,
    adapters,
    dispatcher,
    documents,
    grants,
  });

  const clientId = randomUUID();

  try {
    grants.connect(localTestOrigin, clientId);
  } catch {}

  grants.approve(clientId, localTestOrigin);
  const principal = grants.connect(localTestOrigin, clientId);

  return {
    store,
    database,
    monitor,
    grants,
    controller,
    principal,
    session,
    delivered,
    close: async () => {
      await controller.close();
      permissions.close();
      await adapters.close();
      store.close();
      database.close();
    },
  };
}
