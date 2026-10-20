export const SidebarGroup = {
  Pinned: "pinned",
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
  /** Pins or unpins the row under the cursor (or the open session) while the list has focus. */
  Pin: "p",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Home: "Home",
  End: "End",
} as const

/** Sidebar width in px. At the 960 px desktop breakpoint the maximum still leaves the main pane 480 px. */
export const SidebarWidth = {
  Default: 280,
  Min: 220,
  Max: 480,
  KeyStep: 16,
} as const

/** Per-viewer sidebar width; the value is a decimal pixel count. */
export const SIDEBAR_WIDTH_STORAGE_KEY = "agent-remote:sidebar-width"

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
