import { type DeviceFrame, ErrorCode, errorCode, FrameType, hasErrorCode, type ServerFrame } from '@protocol';
import type { Monitor } from '../monitor/monitor.js';
import type { EventReplay } from '../monitor/replay.js';
import type { TranscriptSources } from '../monitor/history.js';
import type { LocalStore } from '../monitor/store.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { Dispatcher } from '../commands/dispatcher.js';
import type { RuntimeProfileRelay } from '../profiles/runtime/router/relay.js';
import type {
  ProjectSessionsPort,
  SessionModelPort,
  SessionNamesPort,
  SessionRemovalPort,
} from '../domain/ports/session-names.js';
import { logDebug } from '../diagnostics/log.js';
import { readSessionFile } from '../files/session-files.js';
import type { AnalyticsPort } from '../analytics/collector.js';
import type { RulesPort } from '../rules/service.js';
import type { SessionSkillsService } from '../skills/service.js';
import { SessionCatalogRouter } from './session-catalog-router.js';

export type RelayFrameRouterDeps = {
  relay: { send(frame: DeviceFrame): boolean };
  profileRelay: RuntimeProfileRelay;
  readers: TranscriptSources;
  store: LocalStore;
  replay: EventReplay;
  monitor: Monitor;
  adapters: AdapterRegistry;
  dispatcher: Dispatcher;
  names: SessionNamesPort;
  removal?: SessionRemovalPort | undefined;
  models?: SessionModelPort | undefined;
  projects?: ProjectSessionsPort | undefined;
  /** Absent when the usage store could not open. */
  analytics?: AnalyticsPort | undefined;
  rules?: RulesPort | undefined;
  skills: SessionSkillsService;
};

/** A reply's error code: the protocol's own, else a generic failure (daemon-only codes stay on the Mac). */
const codeOf = (error: unknown) =>
  Object.values(ErrorCode).find((code) => code === errorCode(error)) ?? ErrorCode.REQUEST_FAILED;

export class RelayFrameRouter {
  private readonly sessionCatalog: SessionCatalogRouter;

  constructor(private readonly deps: RelayFrameRouterDeps) {
    this.sessionCatalog = new SessionCatalogRouter(
      deps.relay,
      deps.monitor,
      deps.skills,
      deps.readers,
      deps.store,
    );
  }

  async route(frame: ServerFrame): Promise<void> {
    const { relay, profileRelay, replay, monitor, adapters, dispatcher } = this.deps;

    if (await this.sessionCatalog.route(frame)) {
      return;
    }

    if (frame.type === FrameType.ProfilesRequest || frame.type === FrameType.ProfilesCancel) {
      await profileRelay.receive(frame);
    } else if (frame.type === FrameType.HistoryRead) {
      await this.readHistory(frame);
    } else if (frame.type === FrameType.Ack) {
      replay.acknowledge(frame.cursor);
    } else if (frame.type === FrameType.Select) {
      try {
        monitor.select(frame.sessionId);
      } catch (error) {
        logDebug('runtime/relay-frame-router', error);
      }
    } else if (frame.type === FrameType.SessionPin) {
      // The relay sends pins only for its owner's sessions on this device; the snapshot carries the result back.
      monitor.setPinned(frame.sessionId, frame.pinned);
    } else if (frame.type === FrameType.SessionRemove) {
      // Like pins, the relay sends removals only for its owner's sessions on this device.
      await this.deps.removal?.remove(frame.sessionId, frame.mode).catch((error: unknown) => {
        logDebug('runtime/relay-frame-router', error);
      });
    } else if (frame.type === FrameType.SessionModel) {
      // Like renames, the relay sends model switches only for its owner's sessions on this device; it waits for the
      // answer, so the owner sees a switch the session could not take.
      const models = this.deps.models;

      const reply = models
        ? await models.switch(frame.sessionId, frame.choice).then(
            () => ({ ok: true as const, choice: frame.choice }),
            (error: unknown) => {
              logDebug('runtime/relay-frame-router', error);

              return { ok: false as const, code: codeOf(error) };
            },
          )
        : { ok: false as const, code: ErrorCode.CAPABILITY_UNAVAILABLE };

      relay.send({ type: FrameType.SessionModelResult, requestId: frame.requestId, reply });
    } else if (frame.type === FrameType.SessionCreate) {
      // The relay asks only its owner's device; the device starts sessions only in its listed projects.
      const projects = this.deps.projects;

      const reply = projects
        ? await projects.create(frame.session).then(
            (sessionId) => ({ ok: true as const, sessionId }),
            (error: unknown) => {
              logDebug('runtime/relay-frame-router', error);

              return { ok: false as const, code: codeOf(error) };
            },
          )
        : { ok: false as const, code: ErrorCode.CAPABILITY_UNAVAILABLE };

      relay.send({ type: FrameType.SessionCreateResult, requestId: frame.requestId, reply });
    } else if (frame.type === FrameType.SessionRename) {
      await this.deps.names.rename(frame.sessionId, frame.title).catch((error: unknown) => {
        logDebug('runtime/relay-frame-router', error);
      });
    } else if (frame.type === FrameType.FileRequest) {
      // The relay asks only for its owner's sessions on this device; the reader allows only the session's own files.
      const reply = await readSessionFile(monitor, frame.sessionId, frame.path).then(
        (file) => ({ ok: true as const, file }),
        (error: unknown) => ({ ok: false as const, code: codeOf(error) }),
      );

      relay.send({ type: FrameType.FileResult, requestId: frame.requestId, reply });
    } else if (frame.type === FrameType.AnalyticsRequest) {
      // The relay asks only its owner's device; the report holds counts and folder names, never message text.
      const analytics = this.deps.analytics;

      const reply = analytics
        ? await analytics.report(frame.period).then(
            (report) => ({ ok: true as const, report }),
            (error: unknown) => ({ ok: false as const, code: codeOf(error) }),
          )
        : { ok: false as const, code: ErrorCode.CAPABILITY_UNAVAILABLE };

      relay.send({ type: FrameType.AnalyticsResult, requestId: frame.requestId, reply });
    } else if (frame.type === FrameType.RulesRequest) {
      // The relay asks only its owner's device; rules belong to that owner.
      const rules = this.deps.rules;

      const reply = rules
        ? await rules.apply(frame.request).then(
            (result) => ({ ok: true as const, rules: result }),
            (error: unknown) => ({ ok: false as const, code: codeOf(error) }),
          )
        : { ok: false as const, code: ErrorCode.CAPABILITY_UNAVAILABLE };

      relay.send({ type: FrameType.RulesResult, requestId: frame.requestId, reply });
    } else if (frame.type === FrameType.Command) {
      const result = await dispatcher.dispatch(frame.command);

      if (result.sessionId) {
        const snapshot = monitor.snapshot();

        relay.send({ type: FrameType.Snapshot, snapshot, connectors: adapters.list(snapshot.sessions) });
      }

      relay.send({ type: FrameType.CommandResult, result });
    }
  }

  private async readHistory(frame: Extract<ServerFrame, { type: typeof FrameType.HistoryRead }>) {
    const { relay, readers } = this.deps;

    try {
      const codexReader =
        frame.agentId && this.deps.monitor.hasSubagentHistory(frame.sessionId, frame.generation);

      const page = codexReader
        ? await this.deps.monitor.readSubagentHistory(frame)
        : await readers.page(frame);

      for (const message of page.messages) {
        if (
          !relay.send({
            type: FrameType.HistoryItem,
            requestId: frame.requestId,
            sessionId: frame.sessionId,
            generation: frame.generation,
            message,
          })
        ) {
          return;
        }

        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      relay.send({
        type: FrameType.HistoryDone,
        requestId: frame.requestId,
        sessionId: frame.sessionId,
        generation: frame.generation,
        before: page.before,
        after: page.after,
      });
    } catch (error) {
      relay.send({
        type: FrameType.HistoryDone,
        requestId: frame.requestId,
        sessionId: frame.sessionId,
        generation: frame.generation,
        before: null,
        after: null,
        error:
          // A subagent view tells a missing transcript apart from a failed read.
          frame.agentId && hasErrorCode(error, ErrorCode.TRANSCRIPT_UNAVAILABLE)
            ? ErrorCode.TRANSCRIPT_UNAVAILABLE
            : ErrorCode.HISTORY_RELOAD_FAILED,
      });
    }
  }
}
