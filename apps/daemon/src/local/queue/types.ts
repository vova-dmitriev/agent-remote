import type { ClientCommand, PromptTurnBarrier } from '@protocol';

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

/** The queue storage operations a command claim needs. */
export interface QueueClaimStorage {
  load(sessionId: string): QueueDocument;
  setBarrier(sessionId: string, value: QueueBarrier | null): void;
}
