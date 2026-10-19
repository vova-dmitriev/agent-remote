import { DaemonErrorCode } from '../../error-codes.js';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, appendFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { parsePersonalTunnelConfig } from './personal-tunnel.js';
import { CodedError } from '@protocol';

export async function ensurePersonalEnv(path: string) {
  try {
    await writeFile(
      path,
      '# Personal launch: paste your Telegram bot token after the equals sign.\nBOT_TOKEN=\nPERSONAL_POSTGRES_PASSWORD=' +
        randomBytes(32).toString('hex') +
        '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  let values = parseEnv(await readFile(path, 'utf8'));

  if (!values.PERSONAL_POSTGRES_PASSWORD) {
    await appendFile(path, '\nPERSONAL_POSTGRES_PASSWORD=' + randomBytes(32).toString('hex') + '\n');
    values = parseEnv(await readFile(path, 'utf8'));
  }

  if (!values.PERSONAL_REDIS_PASSWORD) {
    await appendFile(path, '\nPERSONAL_REDIS_PASSWORD=' + randomBytes(32).toString('hex') + '\n');
    values = parseEnv(await readFile(path, 'utf8'));
  }

  await chmod(path, 0o600);
  const tunnel = parsePersonalTunnelConfig(values);
  const postgresPassword = values.PERSONAL_POSTGRES_PASSWORD!;

  if (!/^[a-f0-9]{64}$/.test(postgresPassword)) {
    throw new CodedError(DaemonErrorCode.INVALID_PERSONAL_DATABASE_PASSWORD);
  }

  if (!/^[a-f0-9]{64}$/.test(values.PERSONAL_REDIS_PASSWORD!)) {
    throw new CodedError(DaemonErrorCode.INVALID_PERSONAL_REDIS_PASSWORD);
  }

  return {
    tunnel,
    redisUrl: `redis://:${values.PERSONAL_REDIS_PASSWORD}@127.0.0.1:56379/0`,
    botToken: values.BOT_TOKEN ?? '',
    postgresPassword,
    databaseUrl: `postgres://claude_remote:${postgresPassword}@127.0.0.1:55433/claude_remote_personal`,
  };
}

export async function startQuickTunnel(
  port: number,
  options: { executable?: string; timeoutMs?: number; configPath?: string } = {},
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CodedError(DaemonErrorCode.INVALID_LOCAL_PORT);
  }

  const child = spawn(
    options.executable ?? 'cloudflared',
    [
      'tunnel',
      ...(options.configPath ? ['--config', options.configPath] : []),
      '--url',
      `http://127.0.0.1:${port}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let exited = false;

  const exit = new Promise<void>((resolve) =>
    child.once('exit', () => {
      exited = true;
      resolve();
    }),
  );

  const close = async () => {
    if (exited) {
      return;
    }

    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);

    await exit;
    clearTimeout(timer);
  };

  try {
    const origin = await new Promise<string>((resolve, reject) => {
      let buffer = '';

      const timer = setTimeout(
        () => reject(new CodedError(DaemonErrorCode.TUNNEL_START_TIMEOUT)),
        options.timeoutMs ?? 30000,
      );

      const finish = (error?: Error, url?: string) => {
        clearTimeout(timer);

        if (error) {
          reject(error);
        } else {
          resolve(url!);
        }
      };

      const data = (chunk: Buffer) => {
        buffer = (buffer + chunk.toString('utf8')).slice(-16384);
        const match = buffer.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/);

        if (match) {
          finish(undefined, match[0]);
        }
      };

      child.stdout.on('data', data);
      child.stderr.on('data', data);

      child.once('error', () => {
        exited = true;
        finish(new CodedError(DaemonErrorCode.CLOUDFLARED_UNAVAILABLE));
      });

      child.once('exit', () => finish(new CodedError(DaemonErrorCode.TUNNEL_EXITED)));
    });

    return { origin, close, exited: exit };
  } catch (error) {
    await close();
    throw error;
  }
}
