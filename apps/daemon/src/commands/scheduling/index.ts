import type { CommandResult } from '../../../../../packages/protocol/src/index.js';

export class DispatchScheduler {
  readonly queues = new Map<string, Promise<unknown>>();
  readonly inFlight = new Map<string, Promise<CommandResult>>();
}
