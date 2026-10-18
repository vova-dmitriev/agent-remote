import type { ClientCommand, PromptTurnBarrier } from '../../../../../packages/protocol/src/index.js';

export interface QueuedIntent {
  command: ClientCommand;
  clientId: string;
  origin: string;
}

export interface QueueDocument {
  revision: number;
  entries: QueuedIntent[];
}

export interface QueueBarrier extends PromptTurnBarrier {
  generation: string;
  commandId?: string;
}
