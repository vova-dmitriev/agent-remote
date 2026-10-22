import { DaemonErrorCode } from './error-codes.js';
import { SharedPrivateErrorCode } from '@protocol/private';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { mkdir, open, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CodedError } from '@protocol';

/** The CLI default home; `~/.claude/settings.json` hooks post here when CLAUDE_REMOTE_HOME is unset. */
export const defaultStateDirectory = () => join(homedir(), '.claude-remote');
/** Claude Code's config directory, which holds its transcripts under `projects`. */
export const claudeConfigDirectory = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
export const stateDirectory = () => process.env.CLAUDE_REMOTE_HOME ?? defaultStateDirectory();
/** Set to `1` when this daemon is one of several users' daemons on a shared machine (a Linux VM). */
export const MULTI_USER_VARIABLE = 'REMOTE_MULTI_USER';
/**
 * One of several users' daemons on a shared machine: it follows only the sessions it created, never the machine's
 * shared Codex app-server or Codex Desktop. See docs/superpowers/specs/2026-10-21-linux-vm-multi-user-design.md.
 */
export const multiUserMode = () => process.env[MULTI_USER_VARIABLE] === '1';
/** On a shared machine, the directory whose subdirectories are the projects users can start sessions in. */
export const projectsRoot = () => process.env.REMOTE_PROJECTS_ROOT || undefined;
export const configSchema = z.strictObject({
  relayUrl: z.url(),
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
});
export type DaemonConfig = z.infer<typeof configSchema>;

export async function loadConfig() {
  return configSchema.parse(JSON.parse(await readFile(join(stateDirectory(), 'device.json'), 'utf8')));
}

export async function saveConfig(config: DaemonConfig, dir = stateDirectory()) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'device.json');
  const temp = path + '.' + randomBytes(8).toString('hex');

  await writeFile(temp, JSON.stringify(configSchema.parse(config)), { mode: 0o600 });
  await rename(temp, path);
  await chmod(path, 0o600);
}

const LocalKey = { FileName: 'local.key', MaxBytes: 128, Pattern: /^[a-f0-9]{64}$/ } as const;

/** Reads an existing local.key: never through a symlink, owned by the user, 0600, 64 hex chars. */
export async function readLocalSecret(dir: string) {
  const unavailable = () => new CodedError(DaemonErrorCode.LOCAL_KEY_UNAVAILABLE);

  const handle = await open(join(dir, LocalKey.FileName), constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    () => {
      throw unavailable();
    },
  );

  try {
    const info = await handle.stat();

    if (
      !info.isFile() ||
      (process.getuid && info.uid !== process.getuid()) ||
      (info.mode & 0o777) !== 0o600 ||
      info.size > LocalKey.MaxBytes
    ) {
      throw unavailable();
    }

    const value = (await handle.readFile('utf8')).trim();

    if (!LocalKey.Pattern.test(value)) {
      throw unavailable();
    }

    return value;
  } finally {
    await handle.close();
  }
}

export async function localSecret(dir = stateDirectory()) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const value = randomBytes(32).toString('hex');

  try {
    await writeFile(join(dir, LocalKey.FileName), value, { mode: 0o600, flag: 'wx' });

    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  return readLocalSecret(dir);
}

export const hookSocketPath = (directory: string) => join(directory, 'hooks.sock');
export const socketPath = () => hookSocketPath(stateDirectory());

export function validateRelayUrl(value: string) {
  const url = new URL(value);

  if (url.username || url.password || url.search || url.hash) {
    throw new CodedError(DaemonErrorCode.INVALID_RELAY_URL);
  }

  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new CodedError(SharedPrivateErrorCode.HTTPS_REQUIRED);
  }

  return url.origin;
}
