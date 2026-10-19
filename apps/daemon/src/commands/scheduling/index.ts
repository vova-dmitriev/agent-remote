import type { CommandResult } from '@protocol';

export class DispatchScheduler {
  readonly queues = new Map<string, Promise<unknown>>();
  readonly inFlight = new Map<string, Promise<CommandResult>>();
}
