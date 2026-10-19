import { RAIL_BAND_MIN_SIZE, RAIL_HIT_SIZE } from "../config/message-navigation"

export interface RailViewport {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

/** Consecutive messages that share one rail hit target. */
export interface RailGroup {
  /** Index of the first message: the jump target. */
  first: number
  last: number
  /** Track position of the first message. */
  top: number
  /** Center of the hit target, kept inside the track. */
  center: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Maps message offsets onto a track of `height` pixels the way the native scrollbar maps the scrollable
 * `extent`, merging markers whose hit targets would sit closer than `gap`.
 */
export function railGroups(starts: readonly number[], extent: number, height: number, gap = RAIL_HIT_SIZE): RailGroup[] {
  const groups: RailGroup[] = []
  const half = gap / 2

  starts.forEach((start, index) => {
    const position = extent > 0 ? clamp((start / extent) * height, 0, height) : 0
    const center = clamp(position, half, Math.max(half, height - half))
    const current = groups.at(-1)

    if (current && center - current.center < gap) current.last = index
    else groups.push({ first: index, last: index, top: position, center })
  })

  return groups
}

export function railGroupOf(groups: readonly RailGroup[], index: number) {
  return groups.findIndex((group) => group.first <= index && index <= group.last)
}

/** The visible window on the track, sized and moved with the native thumb's formula. */
export function railBand(viewport: RailViewport, height: number, min = RAIL_BAND_MIN_SIZE) {
  const extent = Math.max(viewport.scrollHeight, viewport.clientHeight)
  const range = extent - viewport.clientHeight

  if (extent <= 0 || range <= 0) return { top: 0, size: height }
  const size = clamp((viewport.clientHeight / extent) * height, Math.min(min, height), height)

  return { top: clamp(viewport.scrollTop / range, 0, 1) * (height - size), size }
}

/** The scroll offset that centers the viewport on a clicked track position. */
export function railSeekOffset(position: number, height: number, viewport: RailViewport) {
  const extent = Math.max(viewport.scrollHeight, viewport.clientHeight)
  const target = height > 0 ? (position / height) * extent - viewport.clientHeight / 2 : 0

  return clamp(target, 0, extent - viewport.clientHeight)
}
