import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { CodedError, ErrorCode, LOCAL_LIMITS } from '@protocol';
import { runtimeConfiguration } from '../../local/bootstrap/configuration.js';
import { localClientSecret } from '../../local/bootstrap/identity.js';
import { probeCompanion } from '../../local/bootstrap/probe.js';
import { ensureCompanion } from '../../local/supervisor/index.js';
import { missing, secureDirectory } from '../../local/supervisor/runtime.js';
import { runNativeHost } from '../host/bridge.js';
import { requireSettings } from './settings.js';
import type { BrowserCliContext } from './types.js';

async function exists(path: string) {
  try {
    await lstat(path);

    return true;
  } catch (error) {
    if (missing(error)) {
      return false;
    }

    throw error;
  }
}

async function companionAccess(context: BrowserCliContext) {
  const path = join(context.directory, 'client.sock');
  const capability = await localClientSecret(context.directory);
  const identity = await runtimeConfiguration(context.directory);

  const probe = async () => {
    if ((await exists(join(context.directory, 'hooks.sock'))) && !(await exists(path))) {
      throw new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH);
    }

    const health = await (context.dependencies?.probe ?? probeCompanion)(path, capability);

    if (
      health &&
      (health.instanceId !== identity.instanceId || health.protocolVersion !== LOCAL_LIMITS.protocolVersion)
    ) {
      throw new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH);
    }

    return health;
  };

  return { path, capability, probe };
}

export async function browserHost(context: BrowserCliContext, origin: string) {
  const settings = await requireSettings(context.directory);

  if (!settings.origins.includes(origin)) {
    throw new CodedError(ErrorCode.UNAUTHORIZED);
  }

  const access = await companionAccess(context);

  await (context.dependencies?.bridge ?? runNativeHost)(
    { input: context.input ?? process.stdin, output: context.output },
    {
      path: access.path,
      capability: access.capability,
      origin,
      beforeConnect: async () => {
        await access.probe();

        await (context.dependencies?.ensure ?? ensureCompanion)({
          directory: context.directory,
          runtime: settings.runtime,
          probe: access.probe,
        });
      },
    },
  );
}

export async function startLocal(context: BrowserCliContext) {
  await secureDirectory(context.directory, true, true);
  const access = await companionAccess(context);

  if (await access.probe()) {
    return;
  }

  process.env.REMOTE_INPUT_ENABLED = '1';
  const start = context.dependencies?.startDaemon ?? (await import('../../main.js')).startDaemon;
  const daemon = await start();

  const stop = () => {
    void daemon.close().then(() => {
      process.exitCode = 0;
    });
  };

  if (context.dependencies?.onShutdown) {
    context.dependencies.onShutdown(stop);
  } else {
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}
