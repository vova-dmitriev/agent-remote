import {
  BindingState,
  ConnectorId,
  ErrorCode,
  errorCode,
  FrameType,
  TargetKind,
  type DeviceFrame,
  type ServerFrame,
} from '@protocol';
import type { Monitor } from '../monitor/monitor.js';
import type { LocalStore } from '../monitor/store.js';
import type { TranscriptSources } from '../monitor/history.js';
import type { SessionSkillsService } from '../skills/service.js';
import { logDebug } from '../diagnostics/log.js';
import { sessionWithReadCapabilities } from '../domain/ports/history/read-capabilities.js';

type SessionCatalogRelay = { send(frame: DeviceFrame): boolean };

const codeOf = (error: unknown) =>
  Object.values(ErrorCode).find((code) => code === errorCode(error)) ?? ErrorCode.REQUEST_FAILED;

export class SessionCatalogRouter {
  constructor(
    private readonly relay: SessionCatalogRelay,
    private readonly monitor: Pick<Monitor, 'sessionPage' | 'hasSubagentHistory'>,
    private readonly skills: Pick<SessionSkillsService, 'list'>,
    private readonly readers: Pick<TranscriptSources, 'has' | 'registerLazy'>,
    private readonly store: Pick<LocalStore, 'nativeSession'>,
  ) {}

  async route(frame: ServerFrame): Promise<boolean> {
    if (frame.type === FrameType.SessionListRead) {
      try {
        const page = this.monitor.sessionPage(frame.provider, frame.cursor);

        const sessions = page.sessions.map((session) => {
          const stored = this.store.nativeSession(session.id);

          if (
            stored?.transcriptPath &&
            session.binding === BindingState.Unverified &&
            session.target.connectorId === ConnectorId.Native &&
            session.target.kind === TargetKind.ClaudeCodeCli &&
            stored?.session.generation === session.generation &&
            stored.session.claudeSessionId === session.claudeSessionId &&
            session.claudeSessionId
          ) {
            this.readers.registerLazy(
              session.id,
              session.generation,
              stored.transcriptPath,
              session.claudeSessionId,
            );
          }

          const hasHistory = this.readers.has(session.id);

          return sessionWithReadCapabilities(
            session,
            hasHistory,
            this.monitor.hasSubagentHistory(session.id, session.generation),
          );
        });

        this.relay.send({
          type: FrameType.SessionListResult,
          requestId: frame.requestId,
          reply: { ok: true, page: { sessions, nextCursor: page.nextCursor } },
        });
      } catch (error) {
        logDebug('runtime/session-catalog-router', error);

        this.relay.send({
          type: FrameType.SessionListResult,
          requestId: frame.requestId,
          reply: { ok: false, code: codeOf(error) },
        });
      }

      return true;
    }

    if (frame.type === FrameType.SkillsRequest) {
      const reply = await this.skills.list(frame.sessionId, frame.generation).then(
        (skills) => ({ ok: true as const, skills }),
        (error: unknown) => {
          logDebug('runtime/session-catalog-router', error);

          return { ok: false as const, code: codeOf(error) };
        },
      );

      this.relay.send({ type: FrameType.SkillsResult, requestId: frame.requestId, reply });

      return true;
    }

    return false;
  }
}
