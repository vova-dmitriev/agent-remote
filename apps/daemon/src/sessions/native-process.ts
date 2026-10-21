import { CodedError, ErrorCode, NativeRestartState } from '@protocol';
import type { NativeProcess } from '../domain/ports/native/process.js';
import { NativePidDomain, NativeProcessKind } from '../domain/runtime.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { installationRoot } from '../desktop/bridge-client.js';
import { launchContextSchema, restartArguments } from './launch/launch-context.js';
import { logDebug } from '../diagnostics/log.js';
import { cmuxSurfaceSchema } from '../cmux/context.js';

const execute = promisify(execFile);

const nativeRecord = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string(),
  cwd: z.string(),
  procStart: z.string(),
  pidDomain: z.literal(NativePidDomain.Darwin),
  kind: z.literal(NativeProcessKind.Interactive),
});

export type { NativeProcess } from '../domain/ports/native/process.js';
export type NativeProcessInspection =
  | { state: typeof NativeRestartState.Available; process: NativeProcess }
  | { state: typeof NativeRestartState.Missing | typeof NativeRestartState.Ambiguous };

async function processIdentity(pid: number) {
  try {
    const result = await execute('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm='], {
      timeout: 1500,
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
    });

    const match = result.stdout.trim().match(/^(.{24})\s+(.+)$/);

    if (!match) {
      return undefined;
    }

    let executable = match[2]!;

    if (!isAbsolute(executable)) {
      const helper =
        process.env.CLAUDE_REMOTE_HELPER ??
        join(installationRoot(), 'artifacts/ClaudeRemoteBridge.app/Contents/MacOS/ClaudeBridge');

      const result = await execute(helper, ['--process-context', String(pid)], {
        timeout: 3000,
        maxBuffer: 1048576,
      });

      executable = launchContextSchema.parse(JSON.parse(result.stdout)).executable;
    }

    return { start: match[1]!, executable: await realpath(executable) };
  } catch {
    return undefined;
  }
}

export class NativeProcesses {
  constructor(private configDirectory: string) {}
  private async matches(sessionId?: string, cwd?: string): Promise<NativeProcess[]> {
    const matches: NativeProcess[] = [];
    let names: string[];
    const executables = new Set<string>();

    try {
      names = await readdir(join(this.configDirectory, 'sessions'));

      const candidates = [
        process.env.CLAUDE_REMOTE_NATIVE_CLAUDE,
        join(homedir(), '.local/bin/claude'),
        ...(process.env.PATH ?? '').split(':').map((directory) => join(directory, 'claude')),
      ];

      for (const path of candidates) {
        if (path && isAbsolute(path)) {
          try {
            executables.add(await realpath(path));
          } catch (error) {
            logDebug('sessions/native-process', error);
          }
        }
      }
    } catch {
      return matches;
    }

    for (const name of names.filter((value) => /^\d+\.json$/.test(value)).slice(-4096)) {
      const pid = Number(name.slice(0, -5));

      try {
        process.kill(pid, 0);

        const path = join(this.configDirectory, 'sessions', name),
          info = await lstat(path);

        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.uid !== process.getuid?.() ||
          (info.mode & 0o022) !== 0 ||
          info.size > 32768
        ) {
          continue;
        }

        const parsed = nativeRecord.safeParse(JSON.parse(await readFile(path, 'utf8')));

        if (
          !parsed.success ||
          parsed.data.pid !== pid ||
          (sessionId !== undefined && parsed.data.sessionId !== sessionId) ||
          (cwd && parsed.data.cwd !== cwd)
        ) {
          continue;
        }

        const identity = await processIdentity(pid);

        if (identity?.start === parsed.data.procStart && executables.has(identity.executable)) {
          matches.push(parsed.data);
        }
      } catch {} // ignore: stale or concurrently rewritten native records never grant authority.
    }

    return matches;
  }
  /** Every interactive Claude process of this user that runs now, with the conversation it runs. */
  live(): Promise<NativeProcess[]> {
    return this.matches();
  }
  /** The cmux surface a Claude process runs in, from its own environment; undefined outside cmux. */
  async cmuxSurface(pid: number) {
    try {
      const { stdout } = await execute('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], {
        timeout: 1500,
        maxBuffer: 1048576,
      });

      const value = (name: string) =>
        stdout.match(new RegExp(`(?:^|\\s)${name}=([0-9A-Fa-f-]{36})(?:\\s|$)`))?.[1];

      const surface = cmuxSurfaceSchema.safeParse({
        workspaceId: value('CMUX_WORKSPACE_ID'),
        surfaceId: value('CMUX_SURFACE_ID'),
      });

      return surface.success ? surface.data : undefined;
    } catch {
      return undefined;
    }
  }
  /** A conversation's transcript under the Claude projects directory. */
  async transcript(sessionId: string) {
    if (!/^[\w-]+$/.test(sessionId)) {
      return undefined;
    }

    for (const project of await readdir(join(this.configDirectory, 'projects')).catch(() => [])) {
      const path = join(this.configDirectory, 'projects', project, sessionId + '.jsonl');

      if (
        await lstat(path).then(
          (info) => info.isFile(),
          () => false,
        )
      ) {
        return path;
      }
    }

    return undefined;
  }
  async inspect(sessionId: string, cwd?: string): Promise<NativeProcessInspection> {
    const found = await this.matches(sessionId, cwd);

    if (found.length === 1) {
      return { state: NativeRestartState.Available, process: found[0]! };
    }

    return { state: found.length ? NativeRestartState.Ambiguous : NativeRestartState.Missing };
  }
  async resolve(sessionId: string, cwd?: string) {
    const inspected = await this.inspect(sessionId, cwd);

    return inspected.state === NativeRestartState.Available ? inspected.process : undefined;
  }
  async capture(expected: NativeProcess) {
    const before = await this.resolve(expected.sessionId, expected.cwd);

    if (!before || before.pid !== expected.pid || before.procStart !== expected.procStart) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    try {
      const helper =
        process.env.CLAUDE_REMOTE_HELPER ??
        join(installationRoot(), 'artifacts/ClaudeRemoteBridge.app/Contents/MacOS/ClaudeBridge');

      const result = await execute(helper, ['--process-context', String(expected.pid)], {
        timeout: 3000,
        maxBuffer: 1048576,
      });

      const context = launchContextSchema.parse(JSON.parse(result.stdout));
      const identity = await processIdentity(expected.pid);
      const after = await this.resolve(expected.sessionId, expected.cwd);

      if (
        !after ||
        after.pid !== expected.pid ||
        after.procStart !== expected.procStart ||
        identity?.executable !== (await realpath(context.executable))
      ) {
        throw new Error();
      }

      return { ...context, args: restartArguments(context.args, expected.sessionId) };
    } catch {
      throw new CodedError(ErrorCode.LAUNCH_CONTEXT_UNAVAILABLE);
    }
  }
  async stop(expected: NativeProcess) {
    const current = await this.resolve(expected.sessionId, expected.cwd);

    if (!current || current.pid !== expected.pid || current.procStart !== expected.procStart) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    try {
      process.kill(expected.pid, 'SIGTERM');
    } catch {
      throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
    }

    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
      let alive = true;

      try {
        process.kill(expected.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          alive = false;
        } else {
          throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
        }
      }

      const identity = alive ? await processIdentity(expected.pid) : undefined;

      if (!alive || (identity && identity.start !== expected.procStart)) {
        if ((await this.matches(expected.sessionId, expected.cwd)).length) {
          throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
        }

        return;
      }

      await delay(100);
    }

    throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
  }
}
