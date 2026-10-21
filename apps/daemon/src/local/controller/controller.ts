import { DOCUMENT_OPERATIONS, documentOperation } from './documents.js';
import { localHistory } from './history.js';
import { LocalPersistence } from './persistence.js';
import {
  CodedError,
  type CommandResult,
  ErrorCode,
  FrameType,
  type LocalAction,
  localActionSchema,
  LocalOperation,
  type ServerFrame,
} from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import { LocalDocumentKind } from '../state/values.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { LocalControllerOptions } from './types.js';

export class LocalController {
  private viewers = new Map<symbol, LocalPrincipal>();
  readonly persistence: LocalPersistence;

  constructor(readonly options: LocalControllerOptions) {
    this.persistence = new LocalPersistence(options);
  }

  assertCurrent(principal: LocalPrincipal) {
    if (!this.options.grants.current(principal)) {
      throw new CodedError(ErrorCode.LOCAL_GRANT_REVOKED);
    }
  }

  private session(id: string, generation?: string) {
    const session = this.options.monitor.session(id);

    if (!session || session.target.deviceId !== this.options.deviceId) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    if (generation && session.generation !== generation) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    return session;
  }

  async execute(principal: LocalPrincipal, raw: LocalAction, signal?: AbortSignal): Promise<unknown> {
    this.assertCurrent(principal);
    const action = localActionSchema.parse(raw);

    if ('sessionId' in action && action.sessionId) {
      this.session(action.sessionId, 'generation' in action ? action.generation : undefined);
    }

    const result = await this.route(principal, action, signal);

    this.assertCurrent(principal);

    if ('sessionId' in action && action.sessionId && 'generation' in action) {
      this.session(action.sessionId, action.generation);
    }

    return result;
  }

  hasViewers() {
    return [...this.viewers.values()].some((principal) => this.options.grants.current(principal));
  }

  snapshot(principal: LocalPrincipal, selected: string | null = null): ServerFrame {
    this.assertCurrent(principal);
    const snapshot = this.options.monitor.snapshot();

    snapshot.sessions = snapshot.sessions.map((source) => {
      const title = this.options.documents.get(principal.ownerId, source.id, LocalDocumentKind.Title).value;

      return typeof title === 'string' ? { ...source, title } : source;
    });

    if (snapshot.terminal?.sessionId !== selected) {
      snapshot.terminal = null;
    }

    return {
      type: FrameType.Snapshot,
      deviceId: this.options.deviceId,
      snapshot,
      connectors: this.options.adapters.list(snapshot.sessions),
    };
  }

  subscribe(principal: LocalPrincipal, notify: (frame: ServerFrame) => void, selected: () => string | null) {
    const viewer = Symbol();

    this.viewers.set(viewer, principal);

    const snapshot = () => {
      if (this.options.grants.current(principal)) {
        notify(this.snapshot(principal, selected()));
      } else {
        notify({ type: FrameType.Error, code: ErrorCode.LOCAL_GRANT_REVOKED });
      }
    };

    const event = (envelope: import('@protocol').EventEnvelope) => {
      if (envelope.sessionId === selected() && this.options.grants.current(principal)) {
        notify({ type: FrameType.Event, event: envelope });
      }

      snapshot();
    };

    const receipt = (event: { ownerId: string; result: CommandResult }) => {
      if (event.ownerId === principal.ownerId && this.options.grants.current(principal)) {
        notify({ type: FrameType.CommandResult, result: event.result });
      }
    };

    this.options.monitor.on(RuntimeEvent.CommandResult, receipt);
    this.options.monitor.on(RuntimeEvent.Snapshot, snapshot);
    this.options.monitor.on(RuntimeEvent.Event, event);

    return () => {
      this.viewers.delete(viewer);
      this.options.monitor.off(RuntimeEvent.CommandResult, receipt);
      this.options.monitor.off(RuntimeEvent.Snapshot, snapshot);
      this.options.monitor.off(RuntimeEvent.Event, event);
    };
  }

  private async route(
    principal: LocalPrincipal,
    action: LocalAction,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { store } = this.options;

    if (DOCUMENT_OPERATIONS.has(action.operation)) {
      return documentOperation(this.options, principal, action);
    }

    switch (action.operation) {
      case LocalOperation.Profiles:
        if (
          !this.options.profiles ||
          principal.ownerId !== this.options.ownerId ||
          this.options.profiles.scope.ownerId !== principal.ownerId ||
          this.options.profiles.scope.deviceId !== this.options.deviceId
        ) {
          throw new CodedError(ErrorCode.ACCESS_DENIED);
        }

        return this.options.profiles.request(
          action.request,
          () => !signal?.aborted && this.options.grants.current(principal),
        );
      case LocalOperation.Devices:
        return [{ id: this.options.deviceId, last_seen_at: new Date().toISOString() }];
      case LocalOperation.History:
        return localHistory(this.options, action);
      case LocalOperation.DraftGet:
      case LocalOperation.DraftSave:
      case LocalOperation.QueueGet:
      case LocalOperation.QueueSave:
        return this.persistence.execute(principal, action);

      case LocalOperation.Send: {
        this.session(action.command.sessionId, action.command.generation);

        this.persistence.claim(action.command, principal);

        return this.options.dispatcher.dispatch(store.localCommand(action.command), () =>
          this.options.grants.current(principal),
        );
      }

      case LocalOperation.Receipt:
        return store.receipt(action.commandId);
      case LocalOperation.Select:
      case LocalOperation.Logout:
        return null;
      default:
        if (this.options.media) {
          return this.options.media.execute(principal, action);
        }

        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
    }
  }

  async close() {
    await this.options.profiles?.close();
    await this.persistence.close();
    await this.options.media?.close();
  }
}
