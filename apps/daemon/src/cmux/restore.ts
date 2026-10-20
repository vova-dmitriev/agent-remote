import { TargetKind, type CmuxTarget } from '@protocol';
import type { NativeSessionRegistration } from '../domain/ports/local-store.js';
import type { MonitorPort } from '../domain/ports/monitor.js';
import type { CmuxSurface } from './context.js';
import { logDebug } from '../diagnostics/log.js';

interface CmuxRestoreDeps {
  saved: NativeSessionRegistration[];
  attach: (surface: CmuxSurface, deviceId: string) => Promise<CmuxTarget | undefined>;
  /** Whether a Claude process still runs this conversation. */
  running: (claudeSessionId: string) => Promise<boolean>;
  monitor: MonitorPort;
  onTranscript: (sessionId: string, path: string) => void;
}

/**
 * A cmux session reaches a restarted daemon only with its next hook, so an idle one would stay hidden. Brings back
 * each saved one whose surface cmux still confirms and whose Claude process still runs.
 */
export async function restoreCmuxSessions(deps: CmuxRestoreDeps) {
  for (const { session, transcriptPath } of deps.saved) {
    const target = session.target;

    if (
      target.kind !== TargetKind.Cmux ||
      !session.claudeSessionId ||
      deps.monitor.session(session.id) ||
      !(await deps.running(session.claudeSessionId)) ||
      !(await deps.attach({ workspaceId: target.workspaceId, surfaceId: target.surfaceId }, target.deviceId))
    ) {
      continue;
    }

    try {
      deps.monitor.restoreManaged(session);
    } catch (error) {
      logDebug('cmux/restore', error);
      continue;
    }

    if (transcriptPath) {
      deps.onTranscript(session.id, transcriptPath);
    }
  }
}
