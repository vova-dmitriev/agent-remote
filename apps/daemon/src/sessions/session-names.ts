import { CodedError, ErrorCode, SessionStatus, sessionSchema, type Session } from '@protocol';
import type { Monitor } from '../monitor/monitor.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { TranscriptSources } from '../monitor/history.js';
import type { CodexThreadNaming, SessionNamesPort } from '../domain/ports/session-names.js';
import { logDebug } from '../diagnostics/log.js';

interface SessionNamesDeps {
  monitor: Monitor;
  adapters: Pick<AdapterRegistry, 'resolve'>;
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
    // A line break would submit `/rename` early in a terminal; a title is one line anyway.
    const title = sessionSchema.shape.title.unwrap().safeParse(raw.replace(/\s+/gu, ' '));

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

    if (!('threadId' in session.target) && (await this.renameLive(session, title.data))) {
      native = true;
    }

    monitor.setSessionTitle(sessionId, title.data);

    return native;
  }

  /**
   * A Claude session that takes typed input (in cmux or our terminal) renames itself with `/rename`, so its own
   * screen shows the name at once. Claude runs `/rename` immediately, even mid-turn; any other state may be a
   * dialog that the submitting Enter would answer.
   */
  private async renameLive(session: Session, title: string) {
    const binding = this.deps.monitor.binding(session.id);

    if (
      !session.capabilities?.prompt ||
      !binding ||
      ![SessionStatus.Idle, SessionStatus.Running].some((status) => status === session.status)
    ) {
      return false;
    }

    try {
      await this.deps.adapters.resolve(session.target).sendPrompt(binding, `/rename ${title}`);

      return true;
    } catch (error) {
      logDebug('sessions/session-names', error);

      return false;
    }
  }
}
