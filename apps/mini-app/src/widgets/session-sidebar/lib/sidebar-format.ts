import type { Language } from "@protocol"
import { RelativeUnit, SIDEBAR_DATE_AFTER_DAYS } from "../config/values"

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_HOURS = 24
const unitFormats = new Map<string, Intl.NumberFormat>()
const dateFormats = new Map<Language, Intl.DateTimeFormat>()

function unit(language: Language, value: number, name: RelativeUnit): string {
  const key = language + ":" + name
  let format = unitFormats.get(key)

  if (!format) {
    format = new Intl.NumberFormat(language, { style: "unit", unit: name, unitDisplay: "narrow" })
    unitFormats.set(key, format)
  }

  return format.format(value)
}

function shortDate(language: Language, time: number): string {
  let format = dateFormats.get(language)

  if (!format) {
    format = new Intl.DateTimeFormat(language, { month: "short", day: "numeric" })
    dateFormats.set(language, format)
  }

  return format.format(time)
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

  return shortDate(language, time)
}
