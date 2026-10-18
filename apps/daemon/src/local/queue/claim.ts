import {
  CommandActionType,
  ErrorCode,
  PromptDelivery,
  SessionStatus,
  clientCommandSchema,
  type ClientCommand,
} from '../../../../../packages/protocol/src/index.js';
import type { LocalControllerOptions } from '../controller/types.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { QueueRepository } from './repository.js';
import { assertQueuePrincipal, queueSession, sameQueuedCommand, validateQueueCommand } from './validation.js';

export function claimQueuedCommand(
  options: LocalControllerOptions,
  repository: QueueRepository,
  command: ClientCommand,
  principal: LocalPrincipal,
) {
  assertQueuePrincipal(options, principal);

  const queued = repository
    .load(command.sessionId)
    .entries.find((entry) => entry.command.commandId === command.commandId);

  if (!queued && command.action.type !== CommandActionType.Prompt) {
    return;
  }

  validateQueueCommand(options, command.sessionId, command.generation, command);

  if (queued) {
    const expected = clientCommandSchema.parse(queued.command);

    if (
      command.action.type === CommandActionType.Prompt &&
      expected.action.type === CommandActionType.Prompt &&
      command.action.delivery === PromptDelivery.Immediate
    ) {
      expected.action.delivery = PromptDelivery.Immediate;
    }

    if (!sameQueuedCommand(expected, command)) {
      throw new Error(ErrorCode.COMMAND_ID_REUSED);
    }

    if (!options.grants.approvedClient(queued.clientId, queued.origin)) {
      throw new Error(ErrorCode.LOCAL_GRANT_REVOKED);
    }
  }

  if (options.store.hasLocalIntent(command.commandId)) {
    options.store.localCommand(command);

    return;
  }

  const session = queueSession(options, command.sessionId, command.generation);

  repository.setBarrier(session.id, {
    generation: session.generation,
    commandId: command.commandId,
    lastEventAt: session.lastEventAt,
    observedBusy: session.status !== SessionStatus.Idle,
  });

  options.store.localCommand(command);
}
