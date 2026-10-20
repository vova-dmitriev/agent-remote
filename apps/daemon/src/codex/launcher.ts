import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { mkdir, lstat, chmod, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ManagedCodexChildState,
  ManagedCodexLaunchEvidenceType,
  type ManagedCodexLaunchEvidence,
  type ManagedCodexLaunchOptions,
} from './launch/types.js';
import { CodexLaunchArgument } from '../domain/codex/codex.js';
import { CodedError, ErrorCode } from '@protocol';
import { ManagedCodexPath } from './launch/values.js';
import { managedCodexSocketPath } from './launch/paths.js';
import { forgetOwnedProfileChild, ownedProfileChild, trackOwnedProfileChild } from './launch/owned-child.js';
import { logDebug } from '../diagnostics/log.js';

async function listening(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);

    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 300);

    const done = (alive: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(alive);
    };

    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export function managedCodexSocketListening(path: string): Promise<boolean> {
  return listening(path);
}

export async function managedCodexSocketExited(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const timer = setTimeout(() => finish(false), 300);

    const finish = (exited: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(exited);
    };

    socket.once('connect', () => finish(false));

    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish(error.code === 'ECONNREFUSED' || error.code === 'ENOENT'),
    );
  });
}

export async function managedCodexChildState(pid: number): Promise<ManagedCodexChildState> {
  try {
    process.kill(pid, 0);

    return ManagedCodexChildState.Unverified;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ESRCH') {
      return ManagedCodexChildState.Exited;
    }

    if (code === 'EPERM') {
      return ManagedCodexChildState.Unverified;
    }

    return ManagedCodexChildState.Unknown;
  }
}

export async function ensureManagedCodexSocket(
  stateDirectory: string,
  executable = 'codex',
  options?: ManagedCodexLaunchOptions,
) {
  const environment = options ? { ...options.environment } : undefined;
  const prefixArguments = [...(options?.prefixArguments ?? [])];

  const directory = join(stateDirectory, ManagedCodexPath.Directory),
    path = managedCodexSocketPath(stateDirectory),
    lock = join(directory, ManagedCodexPath.Lock);

  let possibleChild = false;

  const evidence = (value: ManagedCodexLaunchEvidence) => {
    if (value.type === ManagedCodexLaunchEvidenceType.ExistingOrUnknown) {
      possibleChild = true;
    }

    if (value.type === ManagedCodexLaunchEvidenceType.ChildCreated) {
      possibleChild = true;
    }

    if (
      value.type === ManagedCodexLaunchEvidenceType.NoChildCreated ||
      value.type === ManagedCodexLaunchEvidenceType.ChildExited
    ) {
      possibleChild = false;
    }

    options?.onEvidence?.(value);
  };

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);

    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    ) {
      throw new CodedError(ErrorCode.CODEX_INVALID_SOCKET);
    }

    if (await listening(path)) {
      const owned = ownedProfileChild(path, evidence);

      evidence(
        owned?.pid
          ? { type: ManagedCodexLaunchEvidenceType.ChildCreated, pid: owned.pid }
          : { type: ManagedCodexLaunchEvidenceType.ExistingOrUnknown },
      );

      return path;
    }

    let handle;

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        handle = await open(lock, 'wx', 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }

        evidence({ type: ManagedCodexLaunchEvidenceType.ExistingOrUnknown });

        if (await listening(path)) {
          const owned = ownedProfileChild(path, evidence);

          if (owned?.pid) {
            evidence({ type: ManagedCodexLaunchEvidenceType.ChildCreated, pid: owned.pid });
          }

          return path;
        }

        await delay(100);
      }
    }

    if (!handle) {
      throw new CodedError(ErrorCode.CODEX_DAEMON_START_FAILED);
    }

    try {
      if (await listening(path)) {
        const owned = ownedProfileChild(path, evidence);

        evidence(
          owned?.pid
            ? { type: ManagedCodexLaunchEvidenceType.ChildCreated, pid: owned.pid }
            : { type: ManagedCodexLaunchEvidenceType.ExistingOrUnknown },
        );

        return path;
      }

      try {
        const stale = await lstat(path);

        if (!stale.isSocket() || stale.uid !== process.getuid?.()) {
          throw new CodedError(ErrorCode.CODEX_INVALID_SOCKET);
        }

        if (options?.onEvidence) {
          evidence({ type: ManagedCodexLaunchEvidenceType.ExistingOrUnknown });
          throw new CodedError(ErrorCode.CODEX_DAEMON_START_FAILED);
        }

        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      let child;

      try {
        child = spawn(
          executable,
          [
            ...prefixArguments,
            CodexLaunchArgument.Server,
            CodexLaunchArgument.Listen,
            CodexLaunchArgument.UnixSocketPrefix + path,
          ],
          {
            detached: true,
            stdio: 'ignore',
            shell: false,
            ...(environment ? { env: environment, cwd: environment.CODEX_HOME } : {}),
          },
        );
      } catch (error) {
        evidence({ type: ManagedCodexLaunchEvidenceType.NoChildCreated });
        throw error;
      }

      let failed = false;

      child.once('error', () => {
        failed = true;

        if (child.pid === undefined) {
          forgetOwnedProfileChild(path, child);
          evidence({ type: ManagedCodexLaunchEvidenceType.NoChildCreated });
        }
      });

      if (child.pid !== undefined) {
        trackOwnedProfileChild(path, child, () => {
          failed = true;
          evidence({ type: ManagedCodexLaunchEvidenceType.ChildExited, pid: child.pid! });
        });

        evidence({ type: ManagedCodexLaunchEvidenceType.ChildCreated, pid: child.pid });
      } else {
        evidence({ type: ManagedCodexLaunchEvidenceType.ExistingOrUnknown });
      }

      child.unref();

      for (let attempt = 0; attempt < 100; attempt++) {
        if (failed) {
          throw new CodedError(ErrorCode.CODEX_DAEMON_START_FAILED);
        }

        if (await listening(path)) {
          await chmod(path, 0o600);

          return path;
        }

        await delay(100);
      }

      child.kill('SIGTERM');
      throw new CodedError(ErrorCode.CODEX_DAEMON_START_FAILED);
    } finally {
      await handle.close();
      await unlink(lock).catch((error: unknown) => logDebug('codex/launcher', error));
    }
  } catch (error) {
    if (options?.onEvidence && !possibleChild) {
      evidence({ type: ManagedCodexLaunchEvidenceType.NoChildCreated });
    }

    throw error;
  }
}
