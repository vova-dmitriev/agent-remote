import type { AnalyticsReport, Session } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"
import type { UsageSection } from "../config/values"

export interface UsagePageProps {
  deviceId: string
  online: boolean
  /** The device's sessions, to name session rows as the app does. */
  sessions: readonly Session[]
  /** The session the page was opened from: its usage is picked. */
  session: Session | null
  onBack: () => void
}

export interface UsageReportViewProps {
  report: AnalyticsReport
  sessions: readonly Session[]
  /** The picked day and session (the agent's own session id). */
  day: string | undefined
  session: string | undefined
  /** Picks a day or session, or drops it when it is already picked. */
  pickDay: (day: string) => void
  pickSession: (session: string) => void
}

export interface UsageRowsProps {
  section: UsageSection
  title: MessageKey
  rows: AnalyticsReport["byModel"]
  /** Rows the reader can pick to narrow the report to them; the picked one is marked. */
  pick?: { picked: string | undefined; onPick: (key: string) => void }
}

export interface UsageDailyProps {
  days: AnalyticsReport["daily"]
  picked: string | undefined
  onPick: (day: string) => void
}

export interface UsageFiltersProps {
  /** The picked session's name and day, when picked. */
  session: string | undefined
  day: string | undefined
  onClearSession: () => void
  onClearDay: () => void
}
