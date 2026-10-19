import { spawn } from 'node:child_process';
import { ErrorCode, type ProfileAuthMode } from '@protocol';
import { CodexRpcClient } from '../../codex/rpc/rpc-client.js';
import { CodexProfileArgument, ProfileNativeLimits } from './values.js';
import type { ProfileNativeOptions } from './types.js';
import { closeProfileProcess } from './lifecycle/close.js';
import { ProfileProcessCleanupError } from './lifecycle/errors.js';
import { profileNativeArguments } from './config/arguments.js';

export async function openCodexProfileProcess(
  environment: NodeJS.ProcessEnv,
  mode: ProfileAuthMode,
  options: ProfileNativeOptions,
) {
  const child = spawn(
    options.executable,
    [...(options.prefixArguments ?? []), ...profileNativeArguments(mode), CodexProfileArgument.Server],
    { env: environment, cwd: environment.CODEX_HOME, shell: false, stdio: ['pipe', 'pipe', 'ignore'] },
  );

  const client = new CodexRpcClient({
    input: child.stdin,
    output: child.stdout,
    maxFrameBytes: ProfileNativeLimits.FrameBytes,
    timeoutMs: ProfileNativeLimits.TimeoutMs,
    close: closeProfileProcess(child),
  });

  child.once('error', () => client.disconnect(ErrorCode.CODEX_DAEMON_START_FAILED));
  child.once('exit', () => client.disconnect(ErrorCode.CODEX_DISCONNECTED));

  try {
    await client.initialize();

    return client;
  } catch (error) {
    try {
      await client.close();
    } catch {
      throw new ProfileProcessCleanupError();
    }

    throw error;
  }
}
