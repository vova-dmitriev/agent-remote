import { SessionTab, type HistoryPageOutcome, type SessionState } from "@/entities/session"
import type { HistoryMessage, Session } from "@protocol"
import type { HistoryStatus, HistoryDirection } from "@/shared/api"
import type { RenameSessionController } from "@/features/rename-session"
import type { CommandController } from "@/features/send-command"

export interface SessionPageProps {
  session: Session
  state: SessionState
  messages: HistoryMessage[]
  historyStatus?: HistoryStatus
  onHistoryPage?: ((direction: HistoryDirection) => void | Promise<HistoryPageOutcome | void>) | undefined
  readingScope?: string | undefined
  tab: SessionTab
  setTab: (value: SessionTab) => void
  onBack: () => void
  /** The back arrow; the desktop sidebar layout hides it (the sidebar is the way back). */
  showBack?: boolean
  rename?: RenameSessionController
  controller: CommandController
  /** Opens a subagent's read-only view; the caller passes it only where the session's source can read subagent transcripts. */
  onOpenSubagent?: ((agentId: string) => void) | undefined
  /** Opens a changed file as it is now on the Mac. */
  onOpenFile?: ((path: string) => void) | undefined
}
