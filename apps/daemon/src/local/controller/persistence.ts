import {
  ErrorCode,
  LocalOperation,
  localActionSchema,
  type ClientCommand,
  type LocalAction,
} from '../../../../../packages/protocol/src/index.js';
import { LocalQueueEngine } from '../queue/index.js';
import { assertQueuePrincipal, queueBudget, queueSession } from '../queue/validation.js';
import { LocalDocumentKind } from '../state/values.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { LocalControllerOptions } from './types.js';

export class LocalPersistence {
  readonly queue: LocalQueueEngine;

  constructor(private options: LocalControllerOptions) {
    this.queue = new LocalQueueEngine(options);
    this.queue.start();
  }

  async execute(principal: LocalPrincipal, raw: LocalAction): Promise<unknown> {
    assertQueuePrincipal(this.options, principal);
    const action = localActionSchema.parse(raw);

    switch (action.operation) {
      case LocalOperation.QueueGet:
        return this.queue.get(principal, action.sessionId);
      case LocalOperation.QueueSave:
        return this.queue.save(principal, action);

      case LocalOperation.DraftGet: {
        const session = queueSession(this.options, action.sessionId);

        const saved = this.options.documents.get(
          principal.ownerId,
          action.sessionId,
          LocalDocumentKind.Draft,
        );

        const draft = saved.value as { generation: string; text: string; attachments: unknown[] } | null;
        const current = draft?.generation === session.generation ? draft : null;

        return {
          revision: saved.revision,
          text: current?.text ?? '',
          attachments: current?.attachments ?? [],
        };
      }

      case LocalOperation.DraftSave: {
        queueSession(this.options, action.sessionId, action.generation);
        queueBudget(action);
        const { generation, text, attachments } = action;

        const saved = this.options.documents.save(
          principal.ownerId,
          action.sessionId,
          LocalDocumentKind.Draft,
          action.revision,
          { generation, text, attachments },
        );

        return { revision: saved.revision, text, attachments };
      }

      default:
        throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
    }
  }

  claim(command: ClientCommand, principal: LocalPrincipal) {
    this.queue.claim(command, principal);
  }

  close() {
    return this.queue.close();
  }
}
