export const PreviewSource = { Hover: "hover", Focus: "focus" } as const

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
