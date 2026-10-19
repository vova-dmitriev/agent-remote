import { AgentName, HistoryPageOutcome, SessionTab } from "@/entities/session"
import type { HistoryMessage, AppSnapshot, HistoryStatus, HistoryNavigationDirection } from "@protocol"

/** Loads a history page; the outcome tells whether an unchanged edge proves the history there exhausted. */
export type HistoryPageLoader = (direction: HistoryNavigationDirection) => void | Promise<HistoryPageOutcome | void>

export interface SessionFeedProps {
  sessionId: string
  onHistoryPage?: HistoryPageLoader | undefined
  readingScope?: string | undefined
  messages: HistoryMessage[]
  historyStatus?: HistoryStatus
  available?: boolean
  tab: SessionTab
  terminal: AppSnapshot["terminal"]
  agent: AgentName
  /** When the session's newest message happened; newer history is unloaded while the feed ends earlier. */
  newestAt?: number | undefined
}
