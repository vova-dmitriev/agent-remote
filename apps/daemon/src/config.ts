import { DaemonErrorCode } from './error-codes.js';
import { SharedPrivateErrorCode } from '../../../packages/protocol/src/private-error-codes.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const stateDirectory = () => process.env.CLAUDE_REMOTE_HOME ?? join(homedir(), '.claude-remote');
export const configSchema = z.strictObject({
  relayUrl: z.url(),
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
});
export type DaemonConfig = z.infer<typeof configSchema>;

export async function loadConfig() {
  return configSchema.parse(JSON.parse(await readFile(join(stateDirectory(), 'device.json'), 'utf8')));
}

export async function saveConfig(config: DaemonConfig) {
  const dir = stateDirectory();

  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'device.json');
  const temp = path + '.' + randomBytes(8).toString('hex');

  await writeFile(temp, JSON.stringify(configSchema.parse(config)), { mode: 0o600 });
  await rename(temp, path);
  await chmod(path, 0o600);
}

export async function localSecret() {
  const dir = stateDirectory();

  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'local.key');

  try {
    return (await readFile(path, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    const value = randomBytes(32).toString('hex');

    try {
      await writeFile(path, value, { mode: 0o600, flag: 'wx' });

      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return (await readFile(path, 'utf8')).trim();
      }

      throw error;
    }
  }
}

export const socketPath = () => join(stateDirectory(), 'hooks.sock');

export function validateRelayUrl(value: string) {
  const url = new URL(value);

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(DaemonErrorCode.INVALID_RELAY_URL);
  }

  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error(SharedPrivateErrorCode.HTTPS_REQUIRED);
  }

  return url.origin;
}
