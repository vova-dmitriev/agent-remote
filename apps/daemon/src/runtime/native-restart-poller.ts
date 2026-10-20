import { ConnectorId, NativeRestartState, TargetKind } from '@protocol';
import type { Monitor } from '../monitor/monitor.js';
import type { NativeProcesses } from '../sessions/native-process.js';
import { NATIVE_PROCESS_POLL_INTERVAL_MS } from '../runtime-timings.js';
import { logDebug } from '../diagnostics/log.js';

export type NativeRestartPollerDeps = {
  monitor: Monitor;
  nativeProcesses: NativeProcesses;
  inputEnabled: boolean;
  stopping: () => boolean;
};

export class NativeRestartPoller {
  private inspecting = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: NativeRestartPollerDeps) {}

  start() {
    this.timer = setInterval(
      () => void this.refresh().catch((error: unknown) => logDebug('runtime/native-restart-poller', error)),
      NATIVE_PROCESS_POLL_INTERVAL_MS,
    );

    void this.refresh().catch((error: unknown) => logDebug('runtime/native-restart-poller', error));
  }

  stop() {
    clearInterval(this.timer);
  }

  private async refresh() {
    const { monitor, nativeProcesses, inputEnabled, stopping } = this.deps;

    if (this.inspecting || stopping() || !inputEnabled || process.platform !== 'darwin') {
      return;
    }

    this.inspecting = true;

    try {
      for (const source of monitor
        .snapshot()
        .sessions.filter(
          (session) =>
            session.target.connectorId === ConnectorId.Native &&
            session.target.kind === TargetKind.ClaudeCodeCli,
        )) {
        const inspection = source.claudeSessionId
          ? await nativeProcesses.inspect(source.claudeSessionId, source.cwd)
          : { state: NativeRestartState.Missing };

        if (!stopping()) {
          monitor.setNativeRestartState(source.id, source.generation, inspection.state);
        }
      }
    } finally {
      this.inspecting = false;
    }
  }
}
