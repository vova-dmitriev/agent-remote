import type {
  ClientCommand,
  Command,
  CommandResult,
  Cursor,
  EventEnvelope,
  HistoryRead,
  Session,
} from '@protocol';
import type { CommandStoreOutcome } from '../runtime.js';

export interface NativeSessionRegistration {
  session: Session;
  transcriptPath?: string;
}

export interface LocalHistoryPage {
  events: EventEnvelope[];
  before: string | null;
  after: string | null;
}

/** Command ledger and event history persisted by the local store. */
export interface LocalStorePort {
  begin(command: Command): typeof CommandStoreOutcome.New | CommandResult;
  finish(result: CommandResult): void;
  receipt(commandId: string): CommandResult;
  localCommand(command: ClientCommand): Command;
  hasLocalIntent(commandId: string): boolean;
  historyPage(request: Pick<HistoryRead, 'sessionId' | 'direction' | 'anchor'>): LocalHistoryPage;
  cursor(): Cursor;
  pinnedSessions(): Set<string>;
  setPinned(id: string, pinned: boolean): void;
}
