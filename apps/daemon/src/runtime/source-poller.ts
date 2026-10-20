import { ErrorCode, EventType, historySchema, SessionStatus, TargetKind } from '@protocol';
import { ModelOrigin } from '../domain/runtime.js';
import { DesktopOperation } from '../domain/desktop.js';
import {
  SOURCE_POLL_INTERVAL_MS,
  SESSION_ACTIVITY_POLL_INTERVAL_MS,
  ATTACHMENT_RETRY_INTERVAL_MS,
} from '../runtime-timings.js';
import type { Monitor } from '../monitor/monitor.js';
import type { LocalStore } from '../monitor/store.js';
import { type MessageTracker, type TranscriptSources } from '../monitor/history.js';
import { type AdapterRegistry, SourceAdapter } from '../adapters/registry.js';
import type { BridgeClient } from '../desktop/bridge-client.js';
import type { DesktopBinding } from '../desktop/adapter.js';
import { logDebug } from '../diagnostics/log.js';

export type DesktopBindingEntry = { desktop: DesktopBinding; connectorId: string; tracker: MessageTracker };

export type SourcePollerDeps = {
  monitor: Monitor;
  adapters: AdapterRegistry;
  store: LocalStore;
  readers: TranscriptSources;
  desktopBridge: BridgeClient;
  desktopBindings: Map<string, DesktopBindingEntry>;
  inputEnabled: boolean;
  online: () => boolean;
  stopping: () => boolean;
  snapshot: () => void;
  flush: () => void;
  retryAttachmentExports: () => Promise<void>;
};

export class SourcePoller {
  private exportRetryAt = 0;
  private reading = false;
  private polling: Promise<void> = Promise.resolve();
  private activityBusy = false;
  private activityTask: Promise<void> = Promise.resolve();
  private poll: NodeJS.Timeout | undefined;
  private activityPoll: NodeJS.Timeout | undefined;

  constructor(private readonly deps: SourcePollerDeps) {}

  start() {
    this.poll = setInterval(() => this.tick(), SOURCE_POLL_INTERVAL_MS);
    this.activityPoll = setInterval(() => this.refreshActivity(), SESSION_ACTIVITY_POLL_INTERVAL_MS);
    this.refreshActivity();
  }

  stop() {
    clearInterval(this.poll);
    clearInterval(this.activityPoll);
  }

  async drain() {
    await this.polling;
    await this.activityTask;
  }

  private tick() {
    if (this.reading) {
      return;
    }

    this.reading = true;

    this.polling = this.pollOnce()
      .catch(() => {}) // ignore: source failures must not terminate the local daemon.
      .finally(() => {
        this.reading = false;
      });
  }

  private refreshActivity() {
    if (this.deps.stopping() || this.activityBusy) {
      return;
    }

    this.activityBusy = true;

    this.activityTask = this.deps.readers
      .refreshActivity()
      .catch((error: unknown) => logDebug('runtime/source-poller', error))
      .finally(() => {
        this.activityBusy = false;
      });
  }

  private async pollOnce() {
    await this.pollTerminal();
    await this.pollDesktops();
    await this.pollTranscripts();

    if (this.deps.online() && Date.now() >= this.exportRetryAt) {
      this.exportRetryAt = Date.now() + ATTACHMENT_RETRY_INTERVAL_MS;

      await this.deps.retryAttachmentExports();
    }

    this.deps.store.prune();
    this.deps.flush();
  }

  private async pollTerminal() {
    const { monitor, adapters } = this.deps;
    const chosen = monitor.selectedId ? monitor.session(monitor.selectedId) : undefined;

    if (chosen?.target.kind !== TargetKind.Cmux) {
      return;
    }

    const adapter = adapters.resolve(chosen.target),
      binding = monitor.binding(chosen.id);

    if (adapter instanceof SourceAdapter && binding) {
      try {
        const text = await adapter.readScreen(binding);

        monitor.setTerminal({
          sessionId: chosen.id,
          generation: chosen.generation,
          text,
          capturedAt: Date.now(),
        });
      } catch {
        monitor.invalidate(chosen.target.connectorId);
      }
    }
  }

  private async pollDesktops() {
    const { monitor, desktopBridge, desktopBindings, inputEnabled, snapshot } = this.deps;

    for (const [sessionId, item] of desktopBindings) {
      try {
        const result = (await desktopBridge.request({
          operation: DesktopOperation.Read,
          bindingId: item.desktop.bindingId,
        })) as {
          messages: unknown[];
          status: typeof SessionStatus.Idle | typeof SessionStatus.Running;
          canInterrupt: boolean;
          canPrompt: boolean;
        };

        if (
          monitor.applyDesktopRead(sessionId, {
            status: result.status,
            canPrompt: inputEnabled && result.canPrompt,
            canInterrupt: inputEnabled && result.canInterrupt,
          })
        ) {
          for (const value of result.messages) {
            const message = historySchema.safeParse(value);

            if (message.success && item.tracker.accept(message.data)) {
              monitor.publish(sessionId, EventType.Message, message.data);
            }
          }

          snapshot();
        }
      } catch {
        monitor.invalidate(item.connectorId);
        desktopBindings.delete(sessionId);
      }
    }
  }

  private async pollTranscripts() {
    const { monitor, readers } = this.deps;

    for (const [sessionId, reader] of readers.entries()) {
      const session = monitor.session(sessionId);

      if (!session || session.status === SessionStatus.Ended) {
        readers.delete(sessionId);
        continue;
      }

      try {
        const generation = session.generation;
        const modelRevision = monitor.sessionModelRevision(sessionId);
        const messages = await reader.readNext();

        if (
          monitor.session(sessionId)?.generation !== generation ||
          !Array.from(readers.entries()).some(([id, current]) => id === sessionId && current === reader)
        ) {
          continue;
        }

        for (const message of messages) {
          monitor.publish(sessionId, EventType.Message, message);
        }

        monitor.setSessionTitle(sessionId, reader.title);
        monitor.setSessionModel(sessionId, reader.model, ModelOrigin.Transcript, modelRevision);
      } catch {
        if (
          monitor.session(sessionId)?.generation !== session.generation ||
          !readers.delete(sessionId, reader)
        ) {
          continue;
        }

        monitor.publish(sessionId, EventType.Diagnostic, { code: ErrorCode.TRANSCRIPT_UNAVAILABLE });
      }
    }
  }
}
