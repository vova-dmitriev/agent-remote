import { ErrorCode } from '../../../../../packages/protocol/src/index.js';
import { ensureManagedCodexSocket } from '../../codex/launcher.js';
import { profileNativeArguments } from '../../profiles/native/config/arguments.js';
import { profileExecutionNamespace } from './namespace.js';
import { ManagedCodexLaunchEvidenceType, type ManagedCodexLaunchEvidence } from '../../codex/launch/types.js';
import type { ProfiledExecutionLaunch } from './types.js';

interface ProfiledCodexLauncherOptions {
  executable?: string;
  prefixArguments?: readonly string[];
  namespaceRoot?: string;
}

export async function startProfiledCodexRuntime(
  launch: ProfiledExecutionLaunch,
  options: ProfiledCodexLauncherOptions,
): Promise<string> {
  let possibleChild = !!launch.executionLease.processId();
  let sawPossibleChild = possibleChild;
  let launcherEntered = false;
  let noChildEvidence = false;

  const observe = (evidence: ManagedCodexLaunchEvidence) => {
    switch (evidence.type) {
      case ManagedCodexLaunchEvidenceType.ExistingOrUnknown:
        possibleChild = true;
        sawPossibleChild = true;

        return;
      case ManagedCodexLaunchEvidenceType.ChildCreated:
        launch.executionLease.bindProcess(evidence.pid);
        possibleChild = true;
        sawPossibleChild = true;

        return;
      case ManagedCodexLaunchEvidenceType.NoChildCreated:
        noChildEvidence = true;

        if (!sawPossibleChild) {
          possibleChild = false;
        }

        return;
      case ManagedCodexLaunchEvidenceType.ChildExited:
        launch.executionLease.releaseAfterExit();
        possibleChild = false;

        return;
    }
  };

  try {
    const namespace = await profileExecutionNamespace(launch.profile, options.namespaceRoot);

    launch.assertCurrent();
    launch.executionLease.bindSocket(namespace.socketPath);

    launcherEntered = true;

    const path = await ensureManagedCodexSocket(namespace.directory, options.executable, {
      environment: launch.environment,
      prefixArguments: [
        ...(options.prefixArguments ?? []),
        ...profileNativeArguments(launch.profile.authMode),
      ],
      onEvidence: observe,
    });

    if (path !== namespace.socketPath) {
      throw new Error(ErrorCode.CODEX_INVALID_SOCKET);
    }

    if (!launch.executionLease.processId()) {
      throw new Error(ErrorCode.CODEX_DAEMON_START_FAILED);
    }

    launch.executionLease.markReady();
    launch.assertCurrent();

    return path;
  } catch (error) {
    if (!launcherEntered || (!possibleChild && noChildEvidence)) {
      launch.executionLease.releaseBeforeLaunch();
    }

    throw error;
  }
}
