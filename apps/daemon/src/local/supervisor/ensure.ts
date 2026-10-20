import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { CodedError, ErrorCode, LOCAL_LIMITS } from '@protocol';
import { acquireStartLock } from './lock.js';
import { secureDirectory, verifyCompanionRuntime } from './runtime.js';
import type { EnsureCompanionOptions } from './types.js';
import { CompanionArgument, CompanionEnvironment, CompanionFlag, CompanionStartup } from './values.js';

async function compatible(options: EnsureCompanionOptions, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const health = await Promise.race([
      options.probe(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new CodedError(ErrorCode.LOCAL_COMPANION_TIMEOUT)),
          Math.max(1, timeoutMs),
        );
      }),
    ]);

    if (health === null) {
      return false;
    }

    if (
      health.protocolVersion !== LOCAL_LIMITS.protocolVersion ||
      typeof health.instanceId !== 'string' ||
      !health.instanceId
    ) {
      throw new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH);
    }

    // A companion that names no entry script (started inline) cannot be told apart, so it is kept; so is one in this
    // very process.
    if (
      options.replaceOtherBuild &&
      health.pid !== undefined &&
      health.pid !== process.pid &&
      health.entry &&
      health.entry !== options.runtime.entryPath
    ) {
      await stopOtherBuild(options, health.pid, timeoutMs);

      return false;
    }

    return true;
  } finally {
    clearTimeout(timer);
  }
}

/** Stops a companion of another build and waits until its socket stops answering. */
async function stopOtherBuild(options: EnsureCompanionOptions, pid: number, timeoutMs: number) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {} // ignore: it already exited.

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const health = await options.probe().catch(() => null); // ignore: a failed probe means it is gone.

    if (health === null) {
      return;
    }

    await pause(CompanionStartup.pollMs);
  }

  throw new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH);
}

async function launch(options: EnsureCompanionOptions): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_REMOTE_HOME: options.directory };

  delete env[CompanionEnvironment.LegacyClaudeHooks];

  if (options.legacyClaudeHooks) {
    env[CompanionEnvironment.LegacyClaudeHooks] = CompanionFlag.Enabled;
  }

  const child = spawn(
    options.runtime.nodePath,
    [options.runtime.entryPath, CompanionArgument.Browser, CompanionArgument.StartLocal],
    {
      detached: true,
      stdio: 'ignore',
      cwd: options.directory,
      env,
    },
  );

  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new CodedError(ErrorCode.LOCAL_COMPANION_START_FAILED)));
  });

  child.unref();
}

export async function ensureCompanion(options: EnsureCompanionOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? CompanionStartup.timeoutMs;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new CodedError(ErrorCode.INVALID_REQUEST);
  }

  await secureDirectory(options.directory, true, true);

  if (await compatible(options, timeoutMs)) {
    return;
  }

  await verifyCompanionRuntime(options.runtime);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await compatible(options, deadline - Date.now())) {
      return;
    }

    const release = await acquireStartLock(options.directory);

    if (release) {
      let started = false;
      let ready = false;

      try {
        if (await compatible(options, deadline - Date.now())) {
          ready = true;

          return;
        }

        await verifyCompanionRuntime(options.runtime);
        await launch(options);
        started = true;

        while (Date.now() < deadline) {
          if (await compatible(options, deadline - Date.now())) {
            ready = true;

            return;
          }

          await pause(Math.min(CompanionStartup.pollMs, Math.max(1, deadline - Date.now())));
        }

        throw new CodedError(ErrorCode.LOCAL_COMPANION_TIMEOUT);
      } finally {
        // Retain ambiguous startup locks: the child may outlive this caller.
        if (!started || ready) {
          await release();
        }
      }
    }

    await pause(Math.min(CompanionStartup.pollMs, Math.max(1, deadline - Date.now())));
  }

  throw new CodedError(ErrorCode.LOCAL_COMPANION_TIMEOUT);
}
