import { CodedError, ErrorCode, SessionRemoval, type Session } from '@protocol';
import type { MonitorPort } from '../domain/ports/monitor.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { CodexThreadArchive, SessionRemovalPort } from '../domain/ports/session-names.js';
import { logDebug } from '../diagnostics/log.js';

interface SessionRemoverDeps {
  monitor: MonitorPort;
  adapters: Pick<AdapterRegistry, 'resolve'>;
  codex: () => CodexThreadArchive | undefined;
  /** Stops the Claude process that runs the session, if one runs. */
  stopClaude: (session: Session) => Promise<void>;
}

/** Removes sessions from the lists at the owner's request, and archives or stops them in their agents. */
export class SessionRemover implements SessionRemovalPort {
  constructor(private readonly deps: SessionRemoverDeps) {}

  /**
   * Hides the session; `Archive` also archives a Codex thread (Claude keeps no archive), `End` also stops the agent:
   * the Claude process, or the Codex thread's turn. A refusal from the agent is logged, and the session stays hidden.
   */
  async remove(sessionId: string, mode: SessionRemoval): Promise<void> {
    const { monitor, adapters, codex, stopClaude } = this.deps;
    const session = monitor.session(sessionId);

    if (!session) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    monitor.hide(sessionId);

    const threadId = 'threadId' in session.target ? session.target.threadId : undefined;
    const binding = monitor.binding(sessionId);
    const steps: (() => Promise<unknown>)[] = [];

    if (mode === SessionRemoval.End) {
      if (threadId && binding) {
        steps.push(() => adapters.resolve(session.target).interrupt(binding));
      } else if (!threadId) {
        steps.push(() => stopClaude(session));
      }
    }

    if (mode !== SessionRemoval.Hide && threadId) {
      steps.push(async () => codex()?.archiveThread(threadId));
    }

    for (const step of steps) {
      await step().catch((error: unknown) => logDebug('sessions/session-removal', error));
    }
  }
}
