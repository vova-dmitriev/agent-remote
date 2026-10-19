import { ConnectorId, NativeRestartState, TargetKind } from '@protocol';
import type { Monitor } from '../monitor/monitor.js';
import type { NativeProcesses } from '../sessions/native-process.js';
import { NATIVE_PROCESS_POLL_INTERVAL_MS } from '../runtime-timings.js';

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
    this.timer = setInterval(() => void this.refresh().catch(() => {}), NATIVE_PROCESS_POLL_INTERVAL_MS);
    void this.refresh().catch(() => {});
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
