import { describe, expect, it } from "vitest"
import { HistoryDirection, type EventEnvelope } from "@protocol"
import { HistoryWindow } from "../src/entities/session/api/history-window"
import { HistoryPageOutcome } from "../src/entities/session/config/session-values"
import { historyPageOutcome } from "../src/entities/session/lib/history-page"
import { settleHistoryEdge } from "../src/pages/session/lib/history/history-edges"
import { HistoryPageSkip } from "../src/shared/api/types"

const event = { eventId: "e1" } as EventEnvelope

function loadedWindow(before = "older", after = "newer") {
  const window = new HistoryWindow()

  window.observe({ before, after })

  return window
}

const respond = (events: EventEnvelope[]) => async () => events
const current = () => true

describe("history page outcomes", () => {
  it("maps transport results to outcomes", () => {
    expect(historyPageOutcome([event])).toBe(HistoryPageOutcome.Loaded)
    expect(historyPageOutcome([])).toBe(HistoryPageOutcome.Loaded)
    expect(historyPageOutcome(HistoryPageSkip.Exhausted)).toBe(HistoryPageOutcome.Declined)
    expect(historyPageOutcome(HistoryPageSkip.Busy)).toBe(HistoryPageOutcome.Busy)
    expect(historyPageOutcome(HistoryPageSkip.Stale)).toBe(HistoryPageOutcome.Stale)
    expect(historyPageOutcome(null)).toBe(HistoryPageOutcome.Stale)
  })

  it("declines an edge only when the loaded window has no cursor or found it exhausted", async () => {
    await expect(loadedWindow("", "newer").page(HistoryDirection.Before, respond([event]), current)).resolves.toBe(
      HistoryPageSkip.Exhausted,
    )

    const window = loadedWindow()

    await expect(window.page(HistoryDirection.Before, respond([]), current)).resolves.toEqual([])
    await expect(window.page(HistoryDirection.Before, respond([event]), current)).resolves.toBe(HistoryPageSkip.Exhausted)
  })

  it("reports a window without loaded cursors or a stale selection as stale", async () => {
    await expect(new HistoryWindow().page(HistoryDirection.Before, respond([event]), current)).resolves.toBe(HistoryPageSkip.Stale)
    await expect(loadedWindow().page(HistoryDirection.Before, respond([event]), () => false)).resolves.toBe(HistoryPageSkip.Stale)
    let live = true
    const window = loadedWindow()

    const page = window.page(
      HistoryDirection.Before,
      async () => {
        live = false

        return [event]
      },
      () => live,
    )

    await expect(page).resolves.toBe(HistoryPageSkip.Stale)
  })

  it("keeps the later cap while an earlier page is in flight", async () => {
    let release!: (events: EventEnvelope[]) => void
    const window = loadedWindow()
    const before = window.page(HistoryDirection.Before, () => new Promise((resolve) => (release = resolve)), current)
    const after = await window.page(HistoryDirection.After, respond([event]), current)

    expect(after).toBe(HistoryPageSkip.Busy)

    expect(settleHistoryEdge({ before: null, after: null }, HistoryDirection.After, "tail", historyPageOutcome(after))).toEqual({
      before: null,
      after: null,
    })

    release([event])
    await expect(before).resolves.toEqual([event])
  })
})
