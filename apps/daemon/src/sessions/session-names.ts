import { CodedError, ErrorCode, sessionSchema } from '@protocol';
import type { Monitor } from '../monitor/monitor.js';
import type { TranscriptSources } from '../monitor/history.js';
import type { CodexThreadNaming, SessionNamesPort } from '../domain/ports/session-names.js';
import { logDebug } from '../diagnostics/log.js';

interface SessionNamesDeps {
  monitor: Monitor;
  readers: TranscriptSources;
  codex: () => CodexThreadNaming | undefined;
}

/** Renames sessions in the agents themselves, so Claude Code and Codex show the same name as the app. */
export class SessionNames implements SessionNamesPort {
  constructor(private readonly deps: SessionNamesDeps) {}

  /**
   * Names the session in its agent (a Claude transcript `custom-title`, a Codex `thread/name/set`) and shows the
   * name at once; returns whether the agent itself took it. An agent that keeps no names, or a failed write, still
   * shows the name until the agent reports another.
   */
  async rename(sessionId: string, raw: string): Promise<boolean> {
    const { monitor, readers, codex } = this.deps;
    const session = monitor.session(sessionId);
    const title = sessionSchema.shape.title.unwrap().safeParse(raw);

    if (!session) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    if (!title.success) {
      throw new CodedError(ErrorCode.INVALID_REQUEST);
    }

    let native = false;

    try {
      native =
        'threadId' in session.target
          ? ((await codex()?.renameThread(session.target.threadId, title.data)) ?? false)
          : await readers.appendTitle(sessionId, title.data);
    } catch (error) {
      logDebug('sessions/session-names', error);
    }

    monitor.setSessionTitle(sessionId, title.data);

    return native;
  }
}
