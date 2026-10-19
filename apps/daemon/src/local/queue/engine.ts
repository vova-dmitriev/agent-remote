import {
  CommandStatus,
  LocalOperation,
  PromptDelivery,
  SessionStatus,
  canDeliverPrompt,
  type ClientCommand,
  type LocalAction,
} from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import { LocalDocumentKind } from '../state/values.js';
import type { LocalControllerOptions } from '../controller/types.js';
import type { LocalPrincipal } from '../grants/types.js';
import { QueueRepository } from './repository.js';
import { queueReceipt } from './validation.js';

export class LocalQueueEngine {
  private repository: QueueRepository;
  private scheduled: NodeJS.Immediate | undefined;
  private task: Promise<void> | undefined;
  private pending = false;
  private started = false;
  private closed = false;
  private changed = () => this.kick();

  constructor(private options: LocalControllerOptions) {
    this.repository = new QueueRepository(options);
  }

  start() {
    if (this.started || this.closed) {
      return;
    }

    this.started = true;
    this.options.monitor.on(RuntimeEvent.Snapshot, this.changed);
    this.kick();
  }

  kick() {
    if (this.closed) {
      return;
    }

    this.pending = true;

    if (this.scheduled || this.task) {
      return;
    }

    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      this.pending = false;

      this.task = this.process()
        .catch(() => {})
        .finally(() => {
          this.task = undefined;

          if (this.pending) {
            this.kick();
          }
        });
    });
  }

  get(principal: LocalPrincipal, sessionId: string) {
    return this.repository.get(principal, sessionId);
  }

  save(
    principal: LocalPrincipal,
    action: Extract<LocalAction, { operation: typeof LocalOperation.QueueSave }>,
  ) {
    const saved = this.repository.save(principal, action);

    this.kick();

    return saved;
  }

  claim(command: ClientCommand, principal: LocalPrincipal) {
    this.repository.claim(command, principal);
  }

  private async process() {
    const documents = this.options.documents.list(LocalDocumentKind.Queue);

    await Promise.all(
      documents
        .filter((document) => document.owner === this.options.ownerId)
        .map((document) => this.deliver(document.session)),
    );
  }

  private async deliver(sessionId: string) {
    if (this.closed) {
      return;
    }

    const session = this.options.monitor.session(sessionId);
    const saved = this.repository.load(sessionId);

    const entries = saved.entries.filter(
      (entry) => session && entry.command.generation === session.generation,
    );

    if (entries.length !== saved.entries.length) {
      this.repository.write(sessionId, saved, entries);
      this.kick();

      return;
    }

    const first = entries[0];

    if (!first || !session) {
      return;
    }

    const receipt = queueReceipt(this.options, first.command.commandId);

    if (receipt) {
      if (receipt.status === CommandStatus.Dispatched || receipt.status === CommandStatus.Rejected) {
        this.repository.write(sessionId, saved, entries.slice(1));

        this.options.monitor.emit(RuntimeEvent.CommandResult, {
          ownerId: this.options.ownerId,
          result: receipt,
        });

        this.kick();
      }

      return;
    }

    if (!this.options.grants.approvedClient(first.clientId, first.origin)) {
      return;
    }

    if (!this.repository.releaseBarrier(session)) {
      return;
    }

    if (!canDeliverPrompt(session.status, PromptDelivery.WhenIdle)) {
      return;
    }

    this.repository.setBarrier(sessionId, {
      generation: session.generation,
      commandId: first.command.commandId,
      lastEventAt: session.lastEventAt,
      observedBusy: session.status !== SessionStatus.Idle,
    });

    const prepared = this.options.store.localCommand(first.command);

    const result = await this.options.dispatcher.dispatch(
      prepared,
      () => !this.closed && this.options.grants.approvedClient(first.clientId, first.origin),
    );

    this.options.monitor.emit(RuntimeEvent.CommandResult, { ownerId: this.options.ownerId, result });
    this.kick();
  }

  async close() {
    this.closed = true;
    this.options.monitor.off(RuntimeEvent.Snapshot, this.changed);

    if (this.scheduled) {
      clearImmediate(this.scheduled);
      this.scheduled = undefined;
    }

    await this.task;
  }
}
