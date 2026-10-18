import { ServerErrorCode } from './error-codes.js';
import { SharedPrivateErrorCode } from '../../../packages/protocol/src/private-error-codes.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay.js';
import { NotificationWorker } from './notifications/worker.js';

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

  process.stdout.write('Relay ready\n');
  let closing: Promise<void> | undefined;

  const close = () => {
    closing ??= (async () => {
      await worker.close();
      await relay.close();
      process.exitCode = 0;
    })();

    void closing.catch(() => {
      process.exitCode = 1;
    });
  };

  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    process.stderr.write('SERVER_START_FAILED\n');
    process.exitCode = 1;
  });
}
