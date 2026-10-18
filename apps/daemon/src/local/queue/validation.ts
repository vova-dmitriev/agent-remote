import {
  CommandActionType,
  CommandStatus,
  ErrorCode,
  LOCAL_LIMITS,
  clientCommandSchema,
  type ClientCommand,
  type CommandResult,
} from '../../../../../packages/protocol/src/index.js';
import type { LocalControllerOptions } from '../controller/types.js';
import type { LocalPrincipal } from '../grants/types.js';

export function assertQueuePrincipal(options: LocalControllerOptions, principal: LocalPrincipal) {
  if (principal.ownerId !== options.ownerId || !options.grants.current(principal)) {
    throw new Error(ErrorCode.LOCAL_GRANT_REVOKED);
  }
}

export function queueSession(options: LocalControllerOptions, id: string, generation?: string) {
  const session = options.monitor.session(id);

  if (!session || session.target.deviceId !== options.deviceId) {
    throw new Error(ErrorCode.NOT_FOUND);
  }

  if (generation && session.generation !== generation) {
    throw new Error(ErrorCode.STALE_SESSION);
  }

  return session;
}

export function validateQueueCommand(
  options: LocalControllerOptions,
  id: string,
  generation: string,
  raw: ClientCommand,
) {
  const command = clientCommandSchema.parse(raw);
  const session = queueSession(options, id, generation);

  if (
    command.action.type !== CommandActionType.Prompt ||
    command.sessionId !== id ||
    command.generation !== generation ||
    JSON.stringify(command.target) !== JSON.stringify(session.target)
  ) {
    throw new Error(ErrorCode.STALE_SESSION);
  }

  return command;
}

export function queueReceipt(options: LocalControllerOptions, id: string): CommandResult | null {
  try {
    return options.store.receipt(id);
  } catch (error) {
    if (error instanceof Error && error.message === ErrorCode.NOT_FOUND) {
      return null;
    }

    throw error;
  }
}

export function immutableIntent(options: LocalControllerOptions, id: string) {
  const receipt = queueReceipt(options, id);

  return options.store.hasLocalIntent(id) || (!!receipt && receipt.status !== CommandStatus.Rejected);
}

export function queueBudget(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > LOCAL_LIMITS.logicalBytes) {
    throw new Error(ErrorCode.PROMPT_TOO_LARGE);
  }
}

export function sameQueuedCommand(left: ClientCommand, right: ClientCommand) {
  return JSON.stringify(left) === JSON.stringify(right);
}
