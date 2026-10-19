import type { Language } from "@protocol"
import { RelativeUnit, SIDEBAR_DATE_AFTER_DAYS } from "../config/values"

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_HOURS = 24

function unit(language: Language, value: number, name: RelativeUnit): string {
  return new Intl.NumberFormat(language, { style: "unit", unit: name, unitDisplay: "narrow" }).format(value)
}

/** Compact relative time like Codex: "4m", "3h", "2d", then a short date. Returns null under a minute. */
export function relativeTime(time: number, now: number, language: Language): string | null {
  const minutes = Math.floor(Math.max(0, now - time) / MINUTE_MS)

  if (minutes < 1) return null
  if (minutes < HOUR_MINUTES) return unit(language, minutes, RelativeUnit.Minute)

  const hours = Math.floor(minutes / HOUR_MINUTES)

  if (hours < DAY_HOURS) return unit(language, hours, RelativeUnit.Hour)

  const days = Math.floor(hours / DAY_HOURS)

  if (days < SIDEBAR_DATE_AFTER_DAYS) return unit(language, days, RelativeUnit.Day)

  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(time)
}
