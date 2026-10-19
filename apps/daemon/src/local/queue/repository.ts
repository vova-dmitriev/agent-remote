import { z } from 'zod';
import {
  ErrorCode,
  CommandStatus,
  advancePromptBarrier,
  type Session,
  LOCAL_LIMITS,
  clientCommandSchema,
  type ClientCommand,
  type LocalAction,
  LocalOperation,
} from '@protocol';
import { LocalDocumentKind } from '../state/values.js';
import type { LocalControllerOptions } from '../controller/types.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { QueueBarrier, QueueDocument, QueuedIntent } from './types.js';
import { clearMatchingDraft } from './draft.js';
import { claimQueuedCommand } from './claim.js';
import {
  assertQueuePrincipal,
  immutableIntent,
  queueBudget,
  queueSession,
  queueReceipt,
  sameQueuedCommand,
  validateQueueCommand,
} from './validation.js';

const entriesSchema = z
  .array(
    z.strictObject({ command: clientCommandSchema, clientId: z.uuid(), origin: z.string().min(1).max(512) }),
  )
  .max(LOCAL_LIMITS.queueLimit);

export class QueueRepository {
  constructor(readonly options: LocalControllerOptions) {}

  load(sessionId: string): QueueDocument {
    const saved = this.options.documents.get(this.options.ownerId, sessionId, LocalDocumentKind.Queue);

    return { revision: saved.revision, entries: entriesSchema.parse(saved.value ?? []) };
  }

  write(sessionId: string, document: QueueDocument, entries: QueuedIntent[]) {
    this.options.documents.save(
      this.options.ownerId,
      sessionId,
      LocalDocumentKind.Queue,
      document.revision,
      entries,
    );
  }

  get(principal: LocalPrincipal, sessionId: string) {
    assertQueuePrincipal(this.options, principal);
    queueSession(this.options, sessionId);
    const saved = this.load(sessionId);

    return { revision: saved.revision, intents: saved.entries.map((entry) => entry.command) };
  }

  save(
    principal: LocalPrincipal,
    action: Extract<LocalAction, { operation: typeof LocalOperation.QueueSave }>,
  ) {
    assertQueuePrincipal(this.options, principal);
    queueSession(this.options, action.sessionId, action.generation);
    queueBudget(action.intents);

    return this.options.documents.transaction(() => {
      const previous = this.load(action.sessionId);

      if (previous.revision !== action.revision) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      const ids = new Set<string>();

      const entries = action.intents.map((raw) => {
        const command = validateQueueCommand(this.options, action.sessionId, action.generation, raw);

        if (ids.has(command.commandId)) {
          throw new Error(ErrorCode.COMMAND_ID_REUSED);
        }

        ids.add(command.commandId);
        const existing = previous.entries.find((entry) => entry.command.commandId === command.commandId);

        if (!existing && immutableIntent(this.options, command.commandId)) {
          throw new Error(ErrorCode.COMMAND_ID_REUSED);
        }

        return existing
          ? { ...existing, command }
          : { command, clientId: principal.clientId, origin: principal.origin };
      });

      for (const existing of previous.entries) {
        const next = entries.find((entry) => entry.command.commandId === existing.command.commandId);

        if (
          immutableIntent(this.options, existing.command.commandId) &&
          (!next || !sameQueuedCommand(existing.command, next.command))
        ) {
          throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
        }
      }

      this.write(action.sessionId, previous, entries);

      clearMatchingDraft(
        this.options,
        action.sessionId,
        action.generation,
        entries.filter(
          (entry) => !previous.entries.some((old) => old.command.commandId === entry.command.commandId),
        ),
      );

      return { revision: previous.revision + 1, intents: entries.map((entry) => entry.command) };
    });
  }

  barrier(sessionId: string): QueueBarrier | null {
    return this.options.documents.get(this.options.ownerId, sessionId, LocalDocumentKind.QueueBarrier)
      .value as QueueBarrier | null;
  }

  releaseBarrier(session: Session): boolean {
    const barrier = this.barrier(session.id);

    if (!barrier || barrier.generation !== session.generation) {
      return true;
    }

    const rejected =
      barrier.commandId && queueReceipt(this.options, barrier.commandId)?.status === CommandStatus.Rejected;

    if (!rejected) {
      const previousBusy = barrier.observedBusy;

      if (!advancePromptBarrier(session, barrier)) {
        if (barrier.observedBusy !== previousBusy) {
          this.setBarrier(session.id, barrier);
        }

        return false;
      }
    }

    this.setBarrier(session.id, null);

    return true;
  }

  setBarrier(sessionId: string, value: QueueBarrier | null) {
    const previous = this.options.documents.get(
      this.options.ownerId,
      sessionId,
      LocalDocumentKind.QueueBarrier,
    );

    this.options.documents.save(
      this.options.ownerId,
      sessionId,
      LocalDocumentKind.QueueBarrier,
      previous.revision,
      value,
    );
  }

  claim(command: ClientCommand, principal: LocalPrincipal) {
    claimQueuedCommand(this.options, this, command, principal);
  }
}
