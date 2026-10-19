import { FrameType } from '@protocol';
import { RuntimeEvent } from '../domain/runtime.js';
import { EventReplay } from '../monitor/replay.js';
import type { Monitor } from '../monitor/monitor.js';
import type { LocalStore } from '../monitor/store.js';
import type { TranscriptSources } from '../monitor/history.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { Dispatcher } from '../commands/dispatcher.js';
import type { PermissionBroker } from '../commands/permission-broker.js';
import type { UserInputBroker } from '../commands/user-input-broker.js';
import type { LocalController } from '../local/controller/controller.js';
import type { LocalServices } from '../local/bootstrap/services.js';
import { RuntimeProfileRelay } from '../profiles/runtime/router/relay.js';
import type { DeviceFrame } from '@protocol';
import type { EventEmitter } from 'node:events';

type RelayEndpoint = EventEmitter & { send(frame: DeviceFrame): boolean };

export type RelayLinkDeps = {
  relay: RelayEndpoint;
  monitor: Monitor;
  store: LocalStore;
  adapters: AdapterRegistry;
  readers: TranscriptSources;
  dispatcher: Dispatcher;
  permissions: PermissionBroker;
  userInputs: UserInputBroker;
  localController: LocalController;
  profiles: LocalServices['profiles'];
  retryAttachmentExports: () => Promise<void>;
};

/** Owns the relay connection state (online/stopping) and the snapshot, replay and lifecycle plumbing. */
export class RelayLink {
  online = false;
  stopping = false;
  readonly profileRelay: RuntimeProfileRelay;
  readonly replay: EventReplay;
  private epoch: string | undefined;
  private pendingSnapshot = false;

  constructor(private readonly deps: RelayLinkDeps) {
    const { relay, monitor, store, profiles } = deps;

    this.profileRelay = new RuntimeProfileRelay(
      profiles,
      () => (this.online && !this.stopping ? this.epoch : undefined),
      (frame) => relay.send(frame),
    );

    monitor.on(RuntimeEvent.Snapshot, this.snapshot);
    monitor.on(RuntimeEvent.Event, () => this.snapshot());

    this.replay = new EventReplay(
      store,
      () => new Set(monitor.snapshot().sessions.map((session) => session.id)),
      (event) => relay.send({ type: FrameType.Event, event }),
    );

    relay.on(RuntimeEvent.Online, (epoch?: string) => this.handleOnline(epoch));
    relay.on(RuntimeEvent.Offline, () => this.handleOffline());
  }

  readonly snapshot = () => {
    const { relay, monitor, adapters, readers } = this.deps;

    if (!this.online || this.pendingSnapshot) {
      return;
    }

    this.pendingSnapshot = true;

    setImmediate(() => {
      this.pendingSnapshot = false;

      if (this.online) {
        const current = monitor.snapshot();

        for (const session of current.sessions) {
          if (readers.has(session.id)) {
            session.capabilities.historyWindow = true;
          }
        }

        relay.send({ type: FrameType.Snapshot, snapshot: current, connectors: adapters.list() });
      }
    });
  };

  readonly flush = () => {
    if (this.online) {
      this.replay.flush();
    }
  };

  private handleOnline(epoch?: string) {
    this.epoch = epoch;
    this.online = true;
    this.deps.dispatcher.setConnection(true);
    this.snapshot();
    setImmediate(this.flush);

    void this.deps.retryAttachmentExports().catch(() => {});
  }

  private handleOffline() {
    const { dispatcher, localController, userInputs, permissions } = this.deps;

    this.epoch = undefined;
    this.profileRelay.disconnect();
    this.online = false;
    dispatcher.setConnection(false);

    if (!localController.hasViewers()) {
      userInputs.clear();

      for (const pending of permissions.pending()) {
        permissions.cancelSession(pending.sessionId, pending.generation);
      }
    }
  }
}
