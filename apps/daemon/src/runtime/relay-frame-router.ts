import { type DeviceFrame, ErrorCode, FrameType, type ServerFrame } from '@protocol';
import type { Monitor } from '../monitor/monitor.js';
import type { EventReplay } from '../monitor/replay.js';
import type { TranscriptSources } from '../monitor/history.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { Dispatcher } from '../commands/dispatcher.js';
import type { RuntimeProfileRelay } from '../profiles/runtime/router/relay.js';

export type RelayFrameRouterDeps = {
  relay: { send(frame: DeviceFrame): boolean };
  profileRelay: RuntimeProfileRelay;
  readers: TranscriptSources;
  replay: EventReplay;
  monitor: Monitor;
  adapters: AdapterRegistry;
  dispatcher: Dispatcher;
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
      } catch {}
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
    } catch {
      relay.send({
        type: FrameType.HistoryDone,
        requestId: frame.requestId,
        sessionId: frame.sessionId,
        generation: frame.generation,
        before: null,
        after: null,
        error: ErrorCode.HISTORY_RELOAD_FAILED,
      });
    }
  }
}
