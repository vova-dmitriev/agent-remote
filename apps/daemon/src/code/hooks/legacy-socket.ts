import { hasErrorCode } from '@protocol';
import { DaemonErrorCode } from '../../error-codes.js';
import { LegacyHookSocketState } from '../../domain/ipc.js';
import { defaultStateDirectory, hookSocketPath, localSecret } from '../../config.js';
import { secureDirectory } from '../../local/supervisor/runtime.js';

type HookListener = { close(): Promise<void> };

/**
 * Claude Code hooks installed in ~/.claude/settings.json run `remote hook` without
 * CLAUDE_REMOTE_HOME, so they reach the CLI default socket with the CLI default token.
 * The desktop companion listens there too, through the same hook server, unless a live
 * listener (the CLI daemon) already owns it or the path is unsafe.
 */
export async function startLegacyHookSocket(
  listen: (path: string, token: string) => Promise<HookListener>,
): Promise<{ state: LegacyHookSocketState; close(): Promise<void> }> {
  const directory = defaultStateDirectory();

  try {
    await secureDirectory(directory, true, true);
    const server = await listen(hookSocketPath(directory), await localSecret(directory));

    return { state: LegacyHookSocketState.Listening, close: () => server.close() };
  } catch (error) {
    return {
      state: hasErrorCode(error, DaemonErrorCode.DAEMON_ALREADY_RUNNING)
        ? LegacyHookSocketState.Occupied
        : LegacyHookSocketState.Refused,
      close: async () => {},
    };
  }
}
