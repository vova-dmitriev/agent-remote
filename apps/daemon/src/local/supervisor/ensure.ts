import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { ErrorCode, LOCAL_LIMITS } from '@protocol';
import { acquireStartLock } from './lock.js';
import { secureDirectory, verifyCompanionRuntime } from './runtime.js';
import type { EnsureCompanionOptions } from './types.js';
import { CompanionArgument, CompanionStartup } from './values.js';

async function compatible(options: EnsureCompanionOptions, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const health = await Promise.race([
      options.probe(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(ErrorCode.LOCAL_COMPANION_TIMEOUT)),
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
      throw new Error(ErrorCode.LOCAL_COMPANION_MISMATCH);
    }

    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function launch(options: EnsureCompanionOptions): Promise<void> {
  const child = spawn(
    options.runtime.nodePath,
    [options.runtime.entryPath, CompanionArgument.Browser, CompanionArgument.StartLocal],
    {
      detached: true,
      stdio: 'ignore',
      cwd: options.directory,
      env: { ...process.env, CLAUDE_REMOTE_HOME: options.directory },
    },
  );

  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new Error(ErrorCode.LOCAL_COMPANION_START_FAILED)));
  });

  child.unref();
}

export async function ensureCompanion(options: EnsureCompanionOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? CompanionStartup.timeoutMs;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error(ErrorCode.INVALID_REQUEST);
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

        throw new Error(ErrorCode.LOCAL_COMPANION_TIMEOUT);
      } finally {
        // Retain ambiguous startup locks: the child may outlive this caller.
        if (!started || ready) {
          await release();
        }
      }
    }

    await pause(Math.min(CompanionStartup.pollMs, Math.max(1, deadline - Date.now())));
  }

  throw new Error(ErrorCode.LOCAL_COMPANION_TIMEOUT);
}
