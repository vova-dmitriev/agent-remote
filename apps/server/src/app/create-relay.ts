import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuthService } from '../auth/auth-service.js';
import { Database } from '../db/database.js';
import { DeviceFence } from '../devices/fence.js';
import { DeviceService } from '../devices/service.js';
import { createMessaging, type Messaging } from '../infrastructure/messaging.js';
import { RELAY_RUNTIME, type RelayRuntime } from '../relay-runtime.js';
import { JsonExpressAdapter } from '../http/pipeline/json-express-adapter.js';
import { securityHeaders } from '../http/pipeline/middleware.js';
import type { RelayConfig } from './relay-config.js';
import { RelayModule } from './relay.module.js';

export interface Relay {
  db: Database;
  messaging: Messaging | undefined;
  auth: AuthService;
  devices: DeviceService;
  attachments: RelayRuntime['attachments'];
  command: RelayRuntime['command'];
  dispatchHandoffCreate: RelayRuntime['dispatchHandoffCreate'];
  replay: RelayRuntime['replay'];
  live: RelayRuntime['live'];
  notify: RelayRuntime['notify'];
  listen(port?: number, host?: string): Promise<string>;
  close(): Promise<void>;
}

export async function createRelay(config: RelayConfig): Promise<Relay> {
  const db = new Database(config.databaseUrl, config.schema);
  let messaging: Messaging | undefined;

  try {
    await db.migrate();

    messaging = config.redisUrl
      ? await createMessaging(config.redisUrl, config.databaseUrl + (config.schema ?? 'public'))
      : undefined;
  } catch (error) {
    await db.close();
    throw error;
  }

  const app = await NestFactory.create<NestExpressApplication>(
    RelayModule.register({ config, db, messaging }),
    new JsonExpressAdapter(),
    {
      logger: false,
      bodyParser: false,
    },
  );

  app.use(securityHeaders);

  const runtime = app.get<RelayRuntime>(RELAY_RUNTIME);
  const fence = app.get(DeviceFence);
  const server = app.getHttpServer();

  runtime.attach(server);

  return {
    db,
    messaging,
    auth: app.get(AuthService),
    devices: app.get(DeviceService),
    attachments: runtime.attachments,
    command: runtime.command,
    dispatchHandoffCreate: runtime.dispatchHandoffCreate,
    replay: runtime.replay,
    live: runtime.live,
    notify: runtime.notify,
    async listen(port = 3000, host = '127.0.0.1') {
      await app.listen(port, host);
      const address = server.address();

      return `http://${host}:${typeof address === 'object' && address ? address.port : port}`;
    },
    async close() {
      runtime.shutdown();
      await app.close();
      await fence.drain();
      await messaging?.close();
      await db.close();
    },
  };
}
