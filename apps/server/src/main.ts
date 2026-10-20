import { ServerErrorCode } from './error-codes.js';
import { SharedPrivateErrorCode } from '@protocol/private';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { createRelay, relayLogger } from './app/create-relay.js';
import { logError } from './http/errors/error-log.js';
import { NotificationWorker } from './notifications/worker.js';

const MAIN_CONTEXT = 'RelayMain';

async function main() {
  const databaseUrl = process.env.DATABASE_URL,
    redisUrl = process.env.REDIS_URL,
    botToken = process.env.BOT_TOKEN,
    publicOrigin = process.env.PUBLIC_ORIGIN;

  if (!databaseUrl || !redisUrl || !botToken || !publicOrigin) {
    throw new Error(ServerErrorCode.MISSING_SERVER_CONFIG);
  }

  const origin = new URL(publicOrigin);

  if (
    origin.protocol !== 'https:' &&
    !(
      process.env.ALLOW_INSECURE_LOCAL === '1' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    )
  ) {
    throw new Error(SharedPrivateErrorCode.HTTPS_REQUIRED);
  }

  const relay = await createRelay({
    databaseUrl,
    redisUrl,
    botToken,
    ...(process.env.BOT_USERNAME ? { botUsername: process.env.BOT_USERNAME } : {}),
    publicOrigin: origin.origin,
    inputEnabled: process.env.REMOTE_INPUT_ENABLED === '1',
    permissionsEnabled: process.env.REMOTE_PERMISSIONS_ENABLED === '1',
    staticDirectory: resolve('dist/mini-app'),
  });

  const worker = new NotificationWorker(relay.db, botToken, origin.origin, fetch, relay.messaging?.queue);

  try {
    await worker.start();
    await relay.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
  } catch (error) {
    await worker.close();
    await relay.close();
    throw error;
  }

  Logger.log('Relay ready', MAIN_CONTEXT);
  let closing: Promise<void> | undefined;

  const close = () => {
    closing ??= (async () => {
      await worker.close();
      await relay.close();
      process.exitCode = 0;
    })();

    void closing.catch((error: unknown) => {
      logError(MAIN_CONTEXT, error, ServerErrorCode.SERVER_STOP_FAILED);
      process.exitCode = 1;
    });
  };

  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // JSON lines from the first one: a start that fails before Nest exists still logs through the relay's logger.
  Logger.overrideLogger(relayLogger());

  void main().catch((error: unknown) => {
    logError(MAIN_CONTEXT, error, ServerErrorCode.SERVER_START_FAILED);
    process.exitCode = 1;
  });
}
