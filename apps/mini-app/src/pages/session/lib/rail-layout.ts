import { RAIL_HIT_SIZE, RailTick } from "../config/message-navigation"

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

/** The group whose tick sits nearest a track position (groups are ordered by position). */
export function nearestGroup(groups: readonly RailGroup[], position: number) {
  let best = -1

  groups.forEach((group, index) => {
    if (best < 0 || Math.abs(group.center - position) < Math.abs(groups[best]!.center - position)) best = index
  })

  return best
}

/** 0..1 magnification of a tick at `center` for a pointer at `pointer`; nothing without a pointer. */
export function tickMagnification(center: number, pointer: number | null, reach: number = RailTick.Reach) {
  if (pointer === null) return 0

  return Math.max(0, 1 - Math.abs(center - pointer) / reach)
}
