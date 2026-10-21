import { AnalyticsPeriod } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"

export const USAGE_PERIODS: readonly { period: AnalyticsPeriod; label: MessageKey }[] = [
  { period: AnalyticsPeriod.Today, label: "usageToday" },
  { period: AnalyticsPeriod.Week, label: "usageWeek" },
  { period: AnalyticsPeriod.Month, label: "usageMonth" },
  { period: AnalyticsPeriod.All, label: "usageAll" },
]

export const UsageSection = { Models: "models", Projects: "projects", Sessions: "sessions" } as const

export type UsageSection = (typeof UsageSection)[keyof typeof UsageSection]

/** Rows each section shows; the rest are the long tail. */
export const USAGE_SECTION_ROWS = 10

/** While the device reads its transcripts for the first time, the report is asked for again this often. */
export const USAGE_IMPORT_POLL_MS = 2000
