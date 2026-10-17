import { LocalServiceStatus } from '../domain/cli.js';
import { execFile } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createRelay } from '../../../server/src/relay.js';
import { NotificationWorker } from '../../../server/src/notifications/worker.js';
import { installationRoot } from '../desktop/bridge-client.js';
import { loadConfig } from '../config.js';
import { startDaemon } from '../main.js';
import { ensurePersonalEnv, startQuickTunnel } from './personal-runtime.js';
import { personalBot } from './personal-bot.js';
import { startNamedTunnel } from './personal-tunnel.js';
import { ensureMacConnected } from './pairing/connect.js';

const execute = promisify(execFile);
const localOrigin = 'http://127.0.0.1:3040';

export async function startPersonal(root = installationRoot()) {
  const envPath = join(root, '.env');
  const config = await ensurePersonalEnv(envPath);

  if (!config.botToken.trim()) {
    process.stdout.write(
      `Вставь токен в BOT_TOKEN= в ${envPath}\nСохрани файл и повтори npm run personal.\n`,
    );

    return;
  }

  await access(join(root, 'dist/mini-app/index.html')).catch(() => {
    throw new Error('BUILD_REQUIRED');
  });

  const bot = personalBot(config.botToken.trim());
  const username = await bot.check();

  process.stdout.write('Запуск локальной базы…\n');

  try {
    await execute(
      'docker',
      ['compose', '--env-file', envPath, '-f', join(root, 'compose.local.yml'), 'up', '-d', '--wait'],
      {
        cwd: root,
        timeout: 120000,
        maxBuffer: 65536,
      },
    );
  } catch {
    throw new Error('PERSONAL_DATABASE_START_FAILED');
  }

  let tunnel: Awaited<ReturnType<typeof startQuickTunnel>> | undefined;
  let relay: Awaited<ReturnType<typeof createRelay>> | undefined;
  let worker: NotificationWorker | undefined;
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let companionStarting: Promise<void> = Promise.resolve();
  let poll: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  let starting = false;
  let stopped = false;
  let ready = false;
  let tunnelStopped = false;
  const pairingController = new AbortController();
  let pairingAttempted = false;

  const close = () => {
    if (closing) {
      return closing;
    }

    stopped = true;
    pairingController.abort();
    clearInterval(poll);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);

    closing = (async () => {
      try {
        await worker?.close();
      } finally {
        await companionStarting.catch(() => {});

        try {
          await daemon?.close();
        } finally {
          try {
            await relay?.close();
          } finally {
            await tunnel?.close();
          }
        }
      }
    })();

    return closing;
  };

  const stop = () => {
    stopped = true;
    pairingController.abort();

    if (ready) {
      void close().catch(() => {
        process.exitCode = 1;
      });
    }
  };

  const checkRunning = () => {
    if (stopped) {
      throw new Error('PERSONAL_START_CANCELLED');
    }

    if (tunnelStopped) {
      throw new Error('TUNNEL_EXITED');
    }
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    const dataDirectory = join(root, '.local-data');

    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const configPath = join(dataDirectory, 'cloudflared.yml');

    if (config.tunnel) {
      process.stdout.write('Подключение постоянного HTTPS-адреса…\n');
      tunnel = await startNamedTunnel(3040, config.tunnel, { configPath });
    } else {
      await writeFile(configPath, '{}\n', { mode: 0o600 });
      process.stdout.write('Получение бесплатного HTTPS-адреса…\n');
      tunnel = await startQuickTunnel(3040, { configPath });
    }

    void tunnel.exited.then(() => {
      tunnelStopped = true;

      if (ready && !stopped) {
        process.stderr.write('TUNNEL_EXITED: повтори npm run personal.\n');
        process.exitCode = 1;
        stop();
      }
    });

    checkRunning();

    relay = await createRelay({
      databaseUrl: config.databaseUrl,
      redisUrl: config.redisUrl,
      botToken: config.botToken.trim(),
      publicOrigin: tunnel.origin,
      botUsername: username,
      inputEnabled: true,
      permissionsEnabled: true,
      staticDirectory: join(root, 'dist/mini-app'),
    });

    checkRunning();
    await relay.listen(3040, '127.0.0.1');
    process.stdout.write('Ожидание DNS и HTTPS туннеля…\n');
    let healthy = false;
    const healthDeadline = Date.now() + 180000;

    while (Date.now() < healthDeadline) {
      checkRunning();

      try {
        const response = await fetch(tunnel.origin + '/health', {
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        });

        if (
          response.ok &&
          ((await response.json()) as { status?: string }).status === LocalServiceStatus.Ok
        ) {
          healthy = true;
          break;
        }
      } catch {
        /* DNS and tunnel routing may take a few seconds to converge. */
      }

      await delay(2000);
    }

    if (!healthy) {
      throw new Error('TUNNEL_HEALTH_TIMEOUT');
    }

    checkRunning();
    await bot.setMenu(tunnel.origin);
    await bot.setName();
    checkRunning();

    worker = new NotificationWorker(
      relay.db,
      config.botToken.trim(),
      tunnel.origin,
      fetch,
      relay.messaging?.queue,
    );

    await worker.start();
    checkRunning();

    const connectCompanion = () => {
      if (starting || stopped || daemon) {
        return;
      }

      starting = true;

      companionStarting = (async () => {
        let device;

        try {
          device = await loadConfig();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error('INVALID_LOCAL_DEVICE_CONFIG');
          }

          if (pairingAttempted || stopped) {
            return;
          }

          pairingAttempted = true;

          const connected = await ensureMacConnected({
            relayUrl: localOrigin,
            botUsername: username,
            signal: pairingController.signal,
          });

          if (!connected || stopped) {
            return;
          }

          device = await loadConfig();
        }

        if (device.relayUrl !== localOrigin || stopped) {
          return;
        }

        process.env.REMOTE_INPUT_ENABLED = '1';
        process.env.REMOTE_PERMISSIONS_ENABLED = '1';
        daemon = await startDaemon();
        process.stdout.write('Companion подключён к локальному relay.\n');
      })()
        .catch(() => {
          if (!stopped) {
            process.stderr.write(
              'COMPANION_START_FAILED: повтори подключение командой node apps/daemon/bin/remote.mjs connect и проверь отсутствие другого remote start.\n',
            );
          }
        })
        .finally(() => {
          starting = false;
        });
    };

    connectCompanion();
    poll = setInterval(connectCompanion, 1000);
    ready = true;

    process.stdout.write(
      `Готово: https://t.me/${username}\nВ боте нажми Start, затем «Открыть Agent Remote».\nHTTPS: ${tunnel.origin}\nОстановка: Ctrl+C.\n`,
    );

    return { origin: tunnel.origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}
