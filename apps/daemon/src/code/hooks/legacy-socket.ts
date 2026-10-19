import { lstat } from 'node:fs/promises';
import { CodedError, ErrorCode, hasErrorCode } from '@protocol';
import { DaemonErrorCode } from '../../error-codes.js';
import { IpcMessageType, LegacyHookMessageTypes, LegacyHookSocketState } from '../../domain/ipc.js';
import { defaultStateDirectory, hookSocketPath, readLocalSecret } from '../../config.js';
import { secureDirectory } from '../../local/supervisor/runtime.js';
import type { HookSocketOptions } from './hook-server.js';
import { requestLocal } from './ipc.js';

/** How often the companion tries to take the legacy path back while the CLI daemon holds it. */
export const LEGACY_HOOK_RETRY_MS = 30_000;

type HookListener = { close(): Promise<void> };

async function legacyToken(directory: string) {
  try {
    await lstat(directory);
  } catch {
    throw new CodedError(DaemonErrorCode.LOCAL_KEY_UNAVAILABLE);
  }

  await secureDirectory(directory, true);

  return readLocalSecret(directory);
}

function failedState(error: unknown): LegacyHookSocketState {
  if (hasErrorCode(error, DaemonErrorCode.DAEMON_ALREADY_RUNNING)) {
    return LegacyHookSocketState.Occupied;
  }

  return hasErrorCode(error, DaemonErrorCode.LOCAL_KEY_UNAVAILABLE)
    ? LegacyHookSocketState.KeyUnavailable
    : LegacyHookSocketState.Refused;
}

/**
 * Claude Code hooks installed in ~/.claude/settings.json run `remote hook` without
 * CLAUDE_REMOTE_HOME, so they reach the CLI default socket with the CLI default token.
 * The desktop companion listens there too, hooks only, through the same hook server. It
 * never creates the CLI key, never replaces a live listener, yields the path to the CLI
 * daemon on an authenticated release and takes it back once the path is free again.
 */
export async function startLegacyHookSocket(
  listen: (socket: HookSocketOptions) => Promise<HookListener>,
  options: { retryMs?: number } = {},
) {
  const directory = defaultStateDirectory();
  const retryMs = options.retryMs ?? LEGACY_HOOK_RETRY_MS;
  let state: LegacyHookSocketState = LegacyHookSocketState.Disabled;
  let server: HookListener | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const retired = new Set<HookListener>();

  const schedule = () => {
    if (!stopped) {
      timer = setTimeout(() => void attempt(), retryMs);
      timer.unref();
    }
  };

  const released = (listener: HookListener) => {
    if (server !== listener) {
      return;
    }

    server = undefined;
    state = LegacyHookSocketState.Released;
    retired.add(listener);
    void listener.close().finally(() => retired.delete(listener));
    schedule();
  };

  const attempt = async () => {
    try {
      const token = await legacyToken(directory);
      let ready = false;
      let releasedEarly = false;

      const listener: HookListener = await listen({
        path: hookSocketPath(directory),
        token,
        allowedTypes: LegacyHookMessageTypes,
        onRelease: () => {
          if (ready) {
            released(listener);
          } else {
            releasedEarly = true;
          }
        },
      });

      ready = true;

      if (stopped) {
        await listener.close();

        return;
      }

      server = listener;
      state = LegacyHookSocketState.Listening;

      if (releasedEarly) {
        released(listener);
      }
    } catch (error) {
      state = failedState(error);

      if (state === LegacyHookSocketState.Occupied) {
        schedule();
      }
    }
  };

  await attempt();

  return {
    get state() {
      return state;
    },
    async close() {
      stopped = true;
      clearTimeout(timer);
      await Promise.all([server?.close(), ...[...retired].map((listener) => listener.close())]);
      server = undefined;
    },
  };
}

/**
 * CLI daemon side: asks the desktop companion's legacy listener at `path` to yield it.
 * Resolves once released. A daemon's own hook socket does not accept the request type
 * (DAEMON_ALREADY_RUNNING); any other outcome means the holder did not release the path
 * (HOOK_SOCKET_HELD_BY_COMPANION).
 */
export async function requestHookSocketRelease(path: string, token: string) {
  const reply = await requestLocal(path, { type: IpcMessageType.ReleaseHookSocket, token }).catch(
    () => undefined,
  );

  if (reply?.type === IpcMessageType.ReleaseResult && !reply.code) {
    return;
  }

  throw new CodedError(
    reply?.type === IpcMessageType.ReleaseResult && reply.code === ErrorCode.CAPABILITY_UNAVAILABLE
      ? DaemonErrorCode.DAEMON_ALREADY_RUNNING
      : DaemonErrorCode.HOOK_SOCKET_HELD_BY_COMPANION,
  );
}
