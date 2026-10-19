export const PreviewSource = { Hover: "hover", Focus: "focus" } as const

export type PreviewSource = (typeof PreviewSource)[keyof typeof PreviewSource]

/** Rail hit targets are this tall; markers closer than this merge into one target. */
export const RAIL_HIT_SIZE = 24

/** The viewport band never shrinks below this height, like a native scrollbar thumb. */
export const RAIL_BAND_MIN_SIZE = 16
