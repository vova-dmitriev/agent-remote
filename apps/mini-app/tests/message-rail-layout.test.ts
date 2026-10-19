import { describe, expect, it } from "vitest"
import { RAIL_BAND_MIN_SIZE, RAIL_HIT_SIZE } from "../src/pages/session/config/message-navigation"
import { railBand, railGroupOf, railGroups, railSeekOffset } from "../src/pages/session/lib/rail-layout"

describe("message rail layout", () => {
  it("places every message on the track in the scrollbar's coordinate system", () => {
    const groups = railGroups([0, 1000, 2000, 3000], 4000, 400)

    expect(groups.map((group) => [group.first, group.last, group.top])).toEqual([
      [0, 0, 0],
      [1, 1, 100],
      [2, 2, 200],
      [3, 3, 300],
    ])
  })

  it("merges markers closer than the hit size into one target that starts at its first message", () => {
    const starts = Array.from({ length: 300 }, (_, index) => index * 100)
    const groups = railGroups(starts, 30000, 600)

    expect(groups[0]).toMatchObject({ first: 0, top: 0 })
    expect(groups.at(-1)!.last).toBe(299)

    expect(groups.flatMap((group) => [group.first, group.last])).toEqual(
      groups.flatMap((group, index) => [index ? groups[index - 1]!.last + 1 : 0, group.last]),
    )

    for (const [index, group] of groups.entries()) {
      expect(group.center - RAIL_HIT_SIZE / 2).toBeGreaterThanOrEqual(0)
      expect(group.center + RAIL_HIT_SIZE / 2).toBeLessThanOrEqual(600)
      if (index) expect(group.center - groups[index - 1]!.center).toBeGreaterThanOrEqual(RAIL_HIT_SIZE)
    }

    expect(groups.length).toBeLessThanOrEqual(600 / RAIL_HIT_SIZE)
  })

  it("finds the group that contains a message", () => {
    const groups = railGroups([0, 10, 20, 2000, 3000], 4000, 400)

    expect(railGroupOf(groups, 1)).toBe(0)
    expect(railGroupOf(groups, 3)).toBe(1)
    expect(railGroupOf(groups, 4)).toBe(2)
    expect(railGroupOf(groups, 9)).toBe(-1)
  })

  it("sizes and moves the viewport band exactly like the native thumb", () => {
    expect(railBand({ scrollTop: 0, clientHeight: 500, scrollHeight: 2000 }, 400)).toEqual({ top: 0, size: 100 })
    expect(railBand({ scrollTop: 750, clientHeight: 500, scrollHeight: 2000 }, 400)).toEqual({ top: 150, size: 100 })
    expect(railBand({ scrollTop: 1500, clientHeight: 500, scrollHeight: 2000 }, 400)).toEqual({ top: 300, size: 100 })
    expect(railBand({ scrollTop: 0, clientHeight: 500, scrollHeight: 400 }, 400)).toEqual({ top: 0, size: 400 })
  })

  it("keeps a tiny band visible and still reaches both ends", () => {
    const viewport = { clientHeight: 100, scrollHeight: 100000 }

    expect(railBand({ ...viewport, scrollTop: 0 }, 400)).toEqual({ top: 0, size: RAIL_BAND_MIN_SIZE })
    expect(railBand({ ...viewport, scrollTop: 99900 }, 400)).toEqual({ top: 400 - RAIL_BAND_MIN_SIZE, size: RAIL_BAND_MIN_SIZE })
  })

  it("centers the viewport on a clicked track position within the scroll range", () => {
    const viewport = { scrollTop: 0, clientHeight: 500, scrollHeight: 4000 }

    expect(railSeekOffset(200, 400, viewport)).toBe(1750)
    expect(railSeekOffset(0, 400, viewport)).toBe(0)
    expect(railSeekOffset(400, 400, viewport)).toBe(3500)
  })
})
