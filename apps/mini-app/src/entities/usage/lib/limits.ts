import { TargetKind, UsageProvider, type Language, type RateLimit } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"
import { LIMIT_EXHAUSTED_PERCENT, LIMIT_HIGH_PERCENT, LimitTone, MINUTES_PER_DAY } from "../config/values"

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Whose plan a session's turns count against. */
export const usageProvider = (kind: TargetKind) =>
  kind === TargetKind.CodexCli || kind === TargetKind.CodexDesktop ? UsageProvider.Codex : UsageProvider.Claude

/** A provider's windows, shortest first: the five-hour window before the weekly one. */
export const providerLimits = (limits: readonly RateLimit[], provider: UsageProvider) =>
  limits.filter((limit) => limit.provider === provider).sort((a, b) => a.windowMinutes - b.windowMinutes)

/** "5h" or "7d", and "5-hour window" or "7-day window", as message keys with their count. */
export function windowLength(minutes: number): { short: MessageKey; long: MessageKey; count: number } {
  return minutes % MINUTES_PER_DAY === 0
    ? { short: "limitDays", long: "limitWindowDays", count: minutes / MINUTES_PER_DAY }
    : { short: "limitHours", long: "limitWindowHours", count: Math.round(minutes / 60) }
}

export const limitTone = (percent: number) =>
  percent >= LIMIT_EXHAUSTED_PERCENT ? LimitTone.Exhausted : percent >= LIMIT_HIGH_PERCENT ? LimitTone.High : LimitTone.Low

export const roundPercent = (percent: number) => Math.round(percent)

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

/**
 * The reset as a clock time today, else as a date and time: "14:00", "Oct 25, 07:00". Agents report a reset a moment
 * before the hour (13:59:59.6), so it is shown at the nearest minute.
 */
export function resetTime(resetsAt: number, language: Language, now: number) {
  const at = Math.round(resetsAt / MINUTE_MS) * MINUTE_MS

  return new Intl.DateTimeFormat(language, {
    ...(sameDay(at, now) ? {} : { month: "short", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at)
}

/** "in 3 hours", "in 2 days", "5 minutes ago", in the largest unit that is at least one. */
export function relativeTime(at: number, language: Language, now: number) {
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" })
  const delta = at - now

  if (Math.abs(delta) >= 2 * DAY_MS) return format.format(Math.round(delta / DAY_MS), "day")

  if (Math.abs(delta) >= HOUR_MS) return format.format(Math.round(delta / HOUR_MS), "hour")

  return format.format(Math.round(delta / MINUTE_MS), "minute")
}
