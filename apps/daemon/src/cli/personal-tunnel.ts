import { spawn } from 'node:child_process';
import { chmod, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';

export interface PersonalTunnelConfig {
  origin: string;
  tunnelId: string;
  credentialsFile: string;
}

export function parsePersonalTunnelConfig(
  values: Record<string, string | undefined>,
): PersonalTunnelConfig | undefined {
  const settings = [
    values.PERSONAL_PUBLIC_ORIGIN,
    values.PERSONAL_TUNNEL_ID,
    values.PERSONAL_TUNNEL_CREDENTIALS_FILE,
  ];

  if (settings.every((value) => !value)) {
    return undefined;
  }

  if (settings.some((value) => !value)) {
    throw new Error('INCOMPLETE_PERSONAL_TUNNEL_CONFIG');
  }

  const [origin, tunnelId, credentialsFile] = settings as [string, string, string];
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    throw new Error('INVALID_PERSONAL_PUBLIC_ORIGIN');
  }

  const hostname = url.hostname;
  const labels = hostname.split('.');

  if (
    !/^https:\/\/[a-z0-9.-]+\/?$/i.test(origin) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    isIP(hostname) ||
    hostname.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/[a-z]/.test(labels.at(-1)!) ||
    /\.(localhost|local|internal|lan|home|localdomain|arpa|onion)$/.test(hostname)
  ) {
    throw new Error('INVALID_PERSONAL_PUBLIC_ORIGIN');
  }

  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tunnelId)) {
    throw new Error('INVALID_PERSONAL_TUNNEL_ID');
  }

  if (!isAbsolute(credentialsFile) || /[\0\r\n]/.test(credentialsFile)) {
    throw new Error('INVALID_PERSONAL_TUNNEL_CREDENTIALS_FILE');
  }

  return { origin: url.origin, tunnelId, credentialsFile };
}

export async function startNamedTunnel(
  port: number,
  config: PersonalTunnelConfig,
  options: { configPath: string; executable?: string; timeoutMs?: number },
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INVALID_LOCAL_PORT');
  }

  // Validate callers too: ingress must never broaden an unvalidated hostname.
  const validated = parsePersonalTunnelConfig({
    PERSONAL_PUBLIC_ORIGIN: config.origin,
    PERSONAL_TUNNEL_ID: config.tunnelId,
    PERSONAL_TUNNEL_CREDENTIALS_FILE: config.credentialsFile,
  })!;

  try {
    if (!(await stat(validated.credentialsFile)).isFile()) {
      throw new Error();
    }
  } catch {
    throw new Error('PERSONAL_TUNNEL_CREDENTIALS_UNAVAILABLE');
  }

  try {
    // JSON is a YAML subset; quoting paths prevents YAML injection. Only the path is copied.
    await writeFile(
      options.configPath,
      JSON.stringify(
        {
          tunnel: validated.tunnelId,
          'credentials-file': validated.credentialsFile,
          ingress: [
            { hostname: new URL(validated.origin).hostname, service: `http://127.0.0.1:${port}` },
            { service: 'http_status:404' },
          ],
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );

    await chmod(options.configPath, 0o600);
  } catch {
    throw new Error('PERSONAL_TUNNEL_CONFIG_WRITE_FAILED');
  }

  const child = spawn(
    options.executable ?? 'cloudflared',
    ['tunnel', '--no-autoupdate', '--config', options.configPath, 'run', validated.tunnelId],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let ended = false;

  const exited = new Promise<void>((resolve) => {
    const finish = () => {
      ended = true;
      resolve();
    };

    child.once('exit', finish);
    child.once('close', finish);
  });

  let closing: Promise<void> | undefined;

  const close = () =>
    (closing ??= (async () => {
      if (ended) {
        return;
      }

      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);

      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    })());

  try {
    await new Promise<void>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => finish(new Error('TUNNEL_START_TIMEOUT')), options.timeoutMs ?? 30000);

      const data = (chunk: Buffer) => {
        buffer = (buffer + chunk.toString('utf8')).slice(-16384);

        if (buffer.includes('Registered tunnel connection')) {
          finish();
        }
      };

      const unavailable = () => finish(new Error('CLOUDFLARED_UNAVAILABLE'));
      const prematureExit = () => finish(new Error('TUNNEL_EXITED'));

      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.stdout.off('data', data);
        child.stderr.off('data', data);
        child.off('error', unavailable);
        child.off('exit', prematureExit);
        child.off('close', prematureExit);
        buffer = '';

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      child.stdout.on('data', data);
      child.stderr.on('data', data);
      child.once('error', unavailable);
      child.once('exit', prematureExit);
      child.once('close', prematureExit);
    });

    // Drain logs without exposing credentials or retaining arbitrary child output.
    child.stdout.resume();
    child.stderr.resume();

    return { origin: validated.origin, close, exited };
  } catch (error) {
    await close();
    throw error;
  }
}
