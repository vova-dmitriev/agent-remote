import type { AnalyticsReport, Session } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"
import type { UsageSection } from "../config/values"

export interface UsagePageProps {
  deviceId: string
  online: boolean
  /** The device's sessions, to name session rows as the app does. */
  sessions: readonly Session[]
  onBack: () => void
}

export interface UsageReportViewProps {
  report: AnalyticsReport
  sessions: readonly Session[]
}

export interface UsageRowsProps {
  section: UsageSection
  title: MessageKey
  rows: AnalyticsReport["byModel"]
}

export interface UsageDailyProps {
  days: AnalyticsReport["daily"]
}
