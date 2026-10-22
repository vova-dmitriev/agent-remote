import { describe, expect, it } from "vitest"
import { RAIL_HIT_SIZE, RailTick } from "../src/pages/session/config/message-navigation"
import { nearestGroup, railGroupOf, railGroups, tickMagnification } from "../src/pages/session/lib/rail-layout"
import { railMarks } from "../src/pages/session/lib/history/rail-marks"
import { matchParts } from "../src/pages/session/lib/history/chat-search"

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

  it("picks the tick nearest the pointer, wherever on the track it is", () => {
    const groups = railGroups([0, 1000, 3000], 4000, 400, 8)

    expect(nearestGroup(groups, 0)).toBe(0)
    expect(nearestGroup(groups, 60)).toBe(1)
    expect(nearestGroup(groups, 210)).toBe(2)
    expect(nearestGroup(groups, 400)).toBe(2)
    expect(nearestGroup([], 10)).toBe(-1)
  })

  it("magnifies the tick under the pointer fully and its neighbours less with distance", () => {
    expect(tickMagnification(100, null)).toBe(0)
    expect(tickMagnification(100, 100)).toBe(1)
    expect(tickMagnification(100, 100 + RailTick.Reach / 2)).toBe(0.5)
    expect(tickMagnification(100, 100 - RailTick.Reach)).toBe(0)
    expect(tickMagnification(100, 100 + RailTick.Reach * 2)).toBe(0)
  })
})

describe("rail marks", () => {
  const message = (index: number, role: "user" | "assistant", text = "Loaded " + index) => ({
    id: "m" + index,
    role,
    text,
    occurredAt: index,
  })

  const loaded = [message(4, "user"), message(5, "assistant"), message(6, "user")]
  const map = { starts: [0, 100, 200], total: 300, viewport: { scrollTop: 0, clientHeight: 100, scrollHeight: 300 } }

  it("keeps the feed offsets while the loaded feed holds every outlined message", () => {
    const marks = railMarks(loaded, map, [message(4, "user", "Short"), message(6, "user")])

    expect(marks.messages.map((item) => item.text)).toEqual(["Loaded 4", "Loaded 6"])
    expect(marks.starts).toEqual([0, 200])
    expect(marks.total).toBe(300)
  })

  it("marks outlined messages outside the loaded window in conversation order, evenly spaced", () => {
    const marks = railMarks(loaded, map, [
      message(0, "user"),
      message(2, "user"),
      message(4, "user", "Short"),
      message(6, "user"),
      message(8, "user"),
    ])

    expect(marks.messages.map((item) => item.id)).toEqual(["m0", "m2", "m4", "m6", "m8"])
    expect(marks.messages[2]!.text).toBe("Loaded 4")

    expect(railGroups(marks.starts, Math.max(marks.total, marks.viewport.clientHeight), 500).map((group) => group.top)).toEqual([
      50, 150, 250, 350, 450,
    ])
  })
})

describe("chat search snippet", () => {
  it("marks every match of the words in any case", () => {
    expect(matchParts("Деплой и ещё деплой", "ДЕПЛОЙ")).toEqual([
      { text: "Деплой", match: true },
      { text: " и ещё ", match: false },
      { text: "деплой", match: true },
    ])

    expect(matchParts("text", "")).toEqual([{ text: "text", match: false }])
  })
})
