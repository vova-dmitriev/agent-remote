import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AttachmentService } from '../attachments/service.js';
import { AuthService } from '../auth/auth-service.js';
import { CommandDispatcher } from '../commands/command-dispatcher.js';
import { Database } from '../db/database.js';
import { DeviceState } from '../devices/device-state.js';
import { DeviceFence } from '../devices/fence.js';
import { DeviceService } from '../devices/service.js';
import { createMessaging, type Messaging } from '../infrastructure/messaging.js';
import { Notifier } from '../notifications/notify.js';
import { RelayHub } from '../realtime/relay-hub.js';
import { JsonExpressAdapter } from '../http/pipeline/json-express-adapter.js';
import { securityHeaders } from '../http/pipeline/middleware.js';
import type { RelayConfig } from './relay-config.js';
import { RelayModule } from './relay.module.js';

export interface Relay {
  db: Database;
  messaging: Messaging | undefined;
  auth: AuthService;
  devices: DeviceService;
  attachments: AttachmentService;
  command: CommandDispatcher['command'];
  dispatchHandoffCreate: CommandDispatcher['dispatchHandoffCreate'];
  replay: DeviceState['replay'];
  live: RelayHub['live'];
  notify: Notifier['notify'];
  listen(port?: number, host?: string): Promise<string>;
  close(): Promise<void>;
}

export async function createRelay(config: RelayConfig): Promise<Relay> {
  const db = new Database(config.databaseUrl, config.schema);
  let messaging: Messaging | undefined;
  let app: NestExpressApplication | undefined;

  try {
    await db.migrate();

    messaging = config.redisUrl
      ? await createMessaging(config.redisUrl, config.databaseUrl + (config.schema ?? 'public'))
      : undefined;

    app = await NestFactory.create<NestExpressApplication>(
      RelayModule.register({ config, db, messaging }),
      new JsonExpressAdapter(),
      {
        logger: false,
        bodyParser: false,
        // Rethrow a provider or hook failure instead of exiting the process, so it is released below.
        abortOnError: false,
      },
    );

    app.use(securityHeaders);
    // Starts the maintenance jobs and attaches the WebSocket hub now, as before the Nest migration, not on `listen()`.
    await app.init();

    return facade(app, db, messaging);
  } catch (error) {
    await release(app, messaging, db);
    throw error;
  }
}

/** Resolves the services the facade exposes; a failure here still releases what the start acquired. */
function facade(app: NestExpressApplication, db: Database, messaging: Messaging | undefined): Relay {
  const hub = app.get(RelayHub);
  const dispatcher = app.get(CommandDispatcher);
  const fence = app.get(DeviceFence);
  const server = app.getHttpServer();

  return {
    db,
    messaging,
    auth: app.get(AuthService),
    devices: app.get(DeviceService),
    attachments: app.get(AttachmentService),
    command: dispatcher.command,
    dispatchHandoffCreate: dispatcher.dispatchHandoffCreate,
    replay: app.get(DeviceState).replay,
    live: hub.live,
    notify: app.get(Notifier).notify,
    async listen(port = 3000, host = '127.0.0.1') {
      await app.listen(port, host);
      const address = server.address();

      return `http://${host}:${typeof address === 'object' && address ? address.port : port}`;
    },
    async close() {
      await hub.shutdown();
      await app.close();
      await fence.drain();
      await messaging?.close();
      await db.close();
    },
  };
}

/**
 * Releases what a failed start acquired: the application's hooks stop its timers and subscriptions, then storage
 * closes. It never throws: the start already failed, and that original error is the one the caller must see.
 */
async function release(
  app: NestExpressApplication | undefined,
  messaging: Messaging | undefined,
  db: Database,
) {
  for (const close of [() => app?.close(), () => messaging?.close(), () => db.close()]) {
    try {
      await close();
    } catch {
      // Closing the remaining resources matters more than reporting why this one failed to close.
    }
  }
}
