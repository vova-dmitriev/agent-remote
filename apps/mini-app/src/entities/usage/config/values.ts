/** How a window's use reads at a glance. */
export const LimitTone = {
  Low: "low",
  High: "high",
  Exhausted: "exhausted",
} as const

export type LimitTone = (typeof LimitTone)[keyof typeof LimitTone]

/** At or above these percentages a window reads as high, then exhausted. */
export const LIMIT_HIGH_PERCENT = 70
export const LIMIT_EXHAUSTED_PERCENT = 90

/** A reading older than this may be out of date: the agent refreshes its limits only while it works. */
export const LIMIT_STALE_MS = 30 * 60_000

/** How often relative reset times refresh. */
export const LIMIT_CLOCK_TICK_MS = 60_000

export const MINUTES_PER_DAY = 1440
