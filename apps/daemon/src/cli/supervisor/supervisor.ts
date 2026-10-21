import { mkdir, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CodedError, ErrorCode } from '@protocol';
import { MULTI_USER_VARIABLE, saveConfig, validateRelayUrl } from '../../config.js';
import { CliCommand } from '../../domain/cli.js';
import { logDebug } from '../../diagnostics/log.js';

/** A user's directory name: the relay's owner id, never a path. */
const OWNER_ID = /^[a-zA-Z0-9-]{1,64}$/u;
const DEVICE_FILE = 'device.json';

const issuedSchema = z.object({
  devices: z.array(
    z.object({ ownerId: z.string(), deviceId: z.string().min(1), deviceToken: z.string().min(1) }),
  ),
});

/** A running daemon, as the supervisor watches it. */
interface Daemon {
  once(event: 'exit', listener: () => void): unknown;
  kill(): unknown;
}

export interface SupervisorOptions {
  /** The relay the daemons connect to, reachable as localhost from where they run. */
  relayUrl: string;
  operatorToken: string;
  /** One state directory per user, named after the user's owner id. */
  usersRoot: string;
  projectsRoot?: string | undefined;
  /** Starts `remote start` for a user's state directory with this environment. */
  start: (home: string, env: NodeJS.ProcessEnv) => Daemon;
  fetch?: typeof fetch;
}

/**
 * Runs a shared VM's daemons: asks the relay for a device for every user who opened the app without one, writes
 * it into that user's state directory, and keeps one multi-user daemon running per user directory.
 */
export class Supervisor {
  private readonly daemons = new Map<string, Daemon>();

  constructor(private readonly options: SupervisorOptions) {}

  async tick() {
    await this.provision().catch((error: unknown) => logDebug('cli/supervisor', error));
    await this.run();
  }

  stop() {
    for (const daemon of this.daemons.values()) {
      daemon.kill();
    }

    this.daemons.clear();
  }

  private async provision() {
    const { relayUrl, operatorToken, usersRoot } = this.options;

    const response = await (this.options.fetch ?? fetch)(`${relayUrl}/operator/devices`, {
      method: 'POST',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    if (!response.ok) {
      throw new CodedError(ErrorCode.REQUEST_FAILED);
    }

    for (const device of issuedSchema.parse(await response.json()).devices) {
      if (!OWNER_ID.test(device.ownerId)) {
        continue;
      }

      await saveConfig(
        { relayUrl, deviceId: device.deviceId, deviceToken: device.deviceToken },
        join(usersRoot, device.ownerId),
      );
    }
  }

  private async run() {
    const { usersRoot, projectsRoot, start } = this.options;

    await mkdir(usersRoot, { recursive: true, mode: 0o700 });

    for (const owner of await readdir(usersRoot)) {
      const home = join(usersRoot, owner);

      if (!OWNER_ID.test(owner) || this.daemons.has(owner) || !(await exists(join(home, DEVICE_FILE)))) {
        continue;
      }

      const daemon = start(home, {
        ...process.env,
        CLAUDE_REMOTE_HOME: home,
        [MULTI_USER_VARIABLE]: '1',
        ...(projectsRoot ? { REMOTE_PROJECTS_ROOT: projectsRoot } : {}),
      });

      this.daemons.set(owner, daemon);
      // The next round starts it again.
      daemon.once('exit', () => this.daemons.delete(owner));
    }
  }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** How often the supervisor asks for new users and restarts daemons that exited. */
const SUPERVISOR_INTERVAL_MS = 10_000;

/**
 * `remote supervise` on a shared VM: REMOTE_OPERATOR_TOKEN (required), REMOTE_RELAY_URL (default the relay on this
 * host), REMOTE_USERS_ROOT and REMOTE_PROJECTS_ROOT. Each user's daemon is this same CLI's `start`.
 */
export async function runSupervisor() {
  const operatorToken = process.env.REMOTE_OPERATOR_TOKEN;

  if (!operatorToken) {
    throw new CodedError(ErrorCode.UNAUTHORIZED);
  }

  const { spawn } = await import('node:child_process');

  const supervisor = new Supervisor({
    relayUrl: validateRelayUrl(process.env.REMOTE_RELAY_URL ?? 'http://127.0.0.1:3000'),
    operatorToken,
    usersRoot: process.env.REMOTE_USERS_ROOT ?? '/data/users',
    projectsRoot: process.env.REMOTE_PROJECTS_ROOT,
    start: (_home, env) =>
      spawn(process.execPath, [process.argv[1]!, CliCommand.Start], { env, stdio: 'inherit' }),
  });

  const timer = setInterval(() => void supervisor.tick(), SUPERVISOR_INTERVAL_MS);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      clearInterval(timer);
      supervisor.stop();
    });
  }

  await supervisor.tick();
}
