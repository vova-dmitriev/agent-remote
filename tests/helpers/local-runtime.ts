import {
  AttachmentMode,
  CommandStatus,
  ConnectorTransport,
  IntegrationState,
  TargetKind,
} from '../../packages/protocol/src/index.js';
import { ClaudeHookEvent } from '../../apps/daemon/src/domain/claude.js';
import { randomUUID } from 'node:crypto';
import { AdapterRegistry, SourceAdapter } from '../../apps/daemon/src/adapters/registry.js';
import { Dispatcher } from '../../apps/daemon/src/commands/dispatcher.js';
import { PermissionBroker } from '../../apps/daemon/src/commands/permission-broker.js';
import { Monitor } from '../../apps/daemon/src/monitor/monitor.js';
import { LocalStore } from '../../apps/daemon/src/monitor/store.js';
import { LocalDatabase } from '../../apps/daemon/src/local/state/database.js';
import { LocalGrants } from '../../apps/daemon/src/local/grants/service.js';
import { LocalController } from '../../apps/daemon/src/local/controller/controller.js';
import { LocalMediaRepository } from '../../apps/daemon/src/local/media/repository.js';
import { LocalDocuments } from '../../apps/daemon/src/local/state/documents.js';

export const localTestOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

export function localFixture(directory?: string) {
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
