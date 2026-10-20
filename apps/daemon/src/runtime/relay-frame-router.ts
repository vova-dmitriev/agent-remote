import { type DeviceFrame, ErrorCode, FrameType, hasErrorCode, type ServerFrame } from '@protocol';
import type { Monitor } from '../monitor/monitor.js';
import type { EventReplay } from '../monitor/replay.js';
import type { TranscriptSources } from '../monitor/history.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { Dispatcher } from '../commands/dispatcher.js';
import type { RuntimeProfileRelay } from '../profiles/runtime/router/relay.js';
import type { SessionNamesPort } from '../domain/ports/session-names.js';
import { logDebug } from '../diagnostics/log.js';

export type RelayFrameRouterDeps = {
  relay: { send(frame: DeviceFrame): boolean };
  profileRelay: RuntimeProfileRelay;
  readers: TranscriptSources;
  replay: EventReplay;
  monitor: Monitor;
  adapters: AdapterRegistry;
  dispatcher: Dispatcher;
  names: SessionNamesPort;
};

export class RelayFrameRouter {
  constructor(private readonly deps: RelayFrameRouterDeps) {}

  async route(frame: ServerFrame): Promise<void> {
    const { relay, profileRelay, replay, monitor, adapters, dispatcher } = this.deps;

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
    } else if (frame.type === FrameType.SessionRename) {
      await this.deps.names.rename(frame.sessionId, frame.title).catch((error: unknown) => {
        logDebug('runtime/relay-frame-router', error);
      });
    } else if (frame.type === FrameType.Command) {
      const result = await dispatcher.dispatch(frame.command);

      if (result.sessionId) {
        relay.send({ type: FrameType.Snapshot, snapshot: monitor.snapshot(), connectors: adapters.list() });
      }

      relay.send({ type: FrameType.CommandResult, result });
    }
  }

  private async readHistory(frame: Extract<ServerFrame, { type: typeof FrameType.HistoryRead }>) {
    const { relay, readers } = this.deps;

    try {
      const page = await readers.page(frame);

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
