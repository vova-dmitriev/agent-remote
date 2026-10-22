/** What shows a marker preview: the mouse, keyboard focus, or a tap (touch screens preview before they jump). */
export const PreviewSource = { Hover: "hover", Focus: "focus", Touch: "touch" } as const

export type PreviewSource = (typeof PreviewSource)[keyof typeof PreviewSource]

/** Touch rail targets are this tall; markers closer than this merge into one target. */
export const RAIL_HIT_SIZE = 24

/** With a fine pointer the rail picks the marker nearest the pointer, so ticks may sit this close. */
export const RAIL_TICK_GAP = 8

/** Tick look, Codex-style: a short hairline that a nearby pointer lengthens like a dock magnifies icons. */
export const RailTick = {
  Height: 2,
  Width: 6,
  HoverWidth: 22,
  /** Neighbours within this many pixels of the pointer grow, more the closer they are. */
  Reach: 40,
} as const

/** The conversation outline the rail marks: its query key and how long a loaded outline stands. */
export const HISTORY_OUTLINE_QUERY = "history-outline"
export const HISTORY_OUTLINE_STALE_MS = 60_000

/** Search in the chat: its query key, and how long typing rests before the words are searched. */
export const CHAT_SEARCH_QUERY = "chat-search"
export const CHAT_SEARCH_DEBOUNCE_MS = 300
