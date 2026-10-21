import { TargetKind, type CmuxTarget } from '@protocol';
import { ClaudeHookEvent } from '../domain/claude.js';
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

interface LiveClaude {
  pid: number;
  sessionId: string;
  cwd: string;
}

interface CmuxDiscoverDeps {
  deviceId: string;
  /** Interactive Claude processes that run now. */
  live: () => Promise<LiveClaude[]>;
  /** The cmux surface a process runs in, from its environment; undefined outside cmux. */
  surface: (pid: number) => Promise<CmuxSurface | undefined>;
  transcript: (claudeSessionId: string) => Promise<string | undefined>;
  attach: CmuxRestoreDeps['attach'];
  monitor: MonitorPort;
  onTranscript: CmuxRestoreDeps['onTranscript'];
}

/**
 * Lists the Claude sessions running in cmux that this daemon never saw, such as idle ones opened while another
 * daemon held the hooks. A notification-type hook adds each one without a turn-end event, so nothing is announced.
 */
export async function discoverCmuxSessions(deps: CmuxDiscoverDeps) {
  for (const process of await deps.live()) {
    const known = deps.monitor
      .snapshot()
      .sessions.some(
        (session) => session.claudeSessionId === process.sessionId && session.target.kind === TargetKind.Cmux,
      );

    const surface = known ? undefined : await deps.surface(process.pid);
    const target = surface && (await deps.attach(surface, deps.deviceId));

    if (!target) {
      continue;
    }

    const transcript = await deps.transcript(process.sessionId);

    try {
      deps.monitor.ingestHook(
        {
          hook_event_name: ClaudeHookEvent.Notification,
          session_id: process.sessionId,
          cwd: process.cwd,
          ...(transcript ? { transcript_path: transcript } : {}),
        },
        target.connectorId,
        target,
        { verifiedTerminal: true },
      );
    } catch (error) {
      logDebug('cmux/restore', error);
      continue;
    }

    const session = deps.monitor.findClaude(target.connectorId, process.sessionId);

    if (session && transcript) {
      deps.onTranscript(session.id, transcript);
    }
  }
}
