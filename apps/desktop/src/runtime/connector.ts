import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { ErrorCode, LocalFeature, LOCAL_LIMITS } from '../../../../packages/protocol/src/index.js';
import { loadLocalIdentity, localClientSecret } from '../../../daemon/src/local/bootstrap/identity.js';
import { probeCompanion } from '../../../daemon/src/local/bootstrap/probe.js';
import { ensureCompanion } from '../../../daemon/src/local/supervisor/index.js';
import { secureDirectory } from '../../../daemon/src/local/supervisor/runtime.js';
import type { DesktopCompanionConnector, DesktopCompanionOptions } from '../main/companion-port.js';
import { readDesktopHandle, writeDesktopHandle } from './client-state.js';
import { connectDesktopSocket } from './socket-client.js';
import { installDesktopRuntime } from './install-runtime.js';
import { verifyDesktopRuntime } from '../../../../scripts/desktop/verify-runtime-lib.mjs';

const runFile = promisify(execFile);

type ConnectorDependencies = {
  approveDesktopGrant: typeof approveDesktopGrant;
};

async function approveDesktopGrant(
  nodePath: string,
  entryPath: string,
  directory: string,
  clientId: string,
): Promise<void> {
  await runFile(nodePath, [entryPath, 'browser', 'authorize-desktop', clientId], {
    cwd: directory,
    env: {
      CLAUDE_REMOTE_HOME: directory,
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...(process.env.USERPROFILE ? { USERPROFILE: process.env.USERPROFILE } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
    timeout: 10_000,
    maxBuffer: 32 * 1024,
  });
}

export async function createDesktopCompanionConnector(
  options: DesktopCompanionOptions,
  dependencies: ConnectorDependencies = { approveDesktopGrant },
): Promise<DesktopCompanionConnector> {
  const bundled = await verifyDesktopRuntime({
    resourceRoot: join(options.verifiedResourceRoot, 'desktop-companion'),
    platform: options.platform,
    architecture: options.architecture,
    appVersion: options.appVersion,
    protocolVersion: LOCAL_LIMITS.protocolVersion,
  });

  const verified = await installDesktopRuntime({
    sourceRoot: bundled.root,
    privateUserDataRoot: options.privateUserDataRoot,
    platform: options.platform,
    architecture: options.architecture,
    appVersion: options.appVersion,
    protocolVersion: LOCAL_LIMITS.protocolVersion,
  });

  const directory = join(options.privateUserDataRoot, 'desktop-companion');

  await secureDirectory(directory, true, true);
  const capability = await localClientSecret(directory);
  const identity = await loadLocalIdentity(directory);
  const clientId = identity.instanceId;
  const handlePath = join(directory, 'desktop-client.json');
  let handle = await readDesktopHandle(handlePath, clientId);
  const socketPath = join(directory, 'client.sock');

  const runtime = {
    ...verified.manifest.runtime,
    nodePath: verified.nodePath,
    entryPath: verified.entryPath,
  };

  const probe = () => probeCompanion(socketPath, capability, LocalFeature.DesktopGrants);

  await ensureCompanion({ directory, runtime, probe });

  let connection: Awaited<ReturnType<typeof connectDesktopSocket>>;

  try {
    connection = await connectDesktopSocket(socketPath, capability, clientId, handle);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ErrorCode.LOCAL_APPROVAL_REQUIRED) {
      throw error;
    }

    if (!(await options.confirmLocalAccess())) {
      throw new Error(ErrorCode.LOCAL_APPROVAL_REQUIRED);
    }

    await dependencies.approveDesktopGrant(verified.nodePath, verified.entryPath, directory, clientId);
    connection = await connectDesktopSocket(socketPath, capability, clientId, handle);
  }

  if (connection.handle !== handle) {
    await writeDesktopHandle(handlePath, clientId, connection.handle);
  }

  handle = connection.handle;

  return {
    request: (action, signal) => connection.client.request(action, signal),
    subscribe: (listener) => connection.client.subscribe(listener),
    close: () => connection.client.close(),
  };
}
