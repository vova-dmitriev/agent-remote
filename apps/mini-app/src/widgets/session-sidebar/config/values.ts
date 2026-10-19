export const SidebarGroup = {
  Today: "today",
  Yesterday: "yesterday",
  Earlier: "earlier",
} as const

export type SidebarGroup = (typeof SidebarGroup)[keyof typeof SidebarGroup]

export const SidebarKey = {
  Down: "ArrowDown",
  Up: "ArrowUp",
  Enter: "Enter",
  Escape: "Escape",
  Search: "k",
} as const

export const RelativeUnit = {
  Minute: "minute",
  Hour: "hour",
  Day: "day",
} as const

export type RelativeUnit = (typeof RelativeUnit)[keyof typeof RelativeUnit]

/** Days after which the relative time switches to a calendar date. */
export const SIDEBAR_DATE_AFTER_DAYS = 7

/** Per-viewer collapse state; the value is the string form of a boolean. */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "agent-remote:sidebar-collapsed"

/** Relative times ("4m") refresh on this tick; grouping and labels change at most once a minute. */
export const SIDEBAR_CLOCK_TICK_MS = 60_000
