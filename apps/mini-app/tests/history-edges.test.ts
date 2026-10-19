import { describe, expect, it } from "vitest"
import { HistoryDirection } from "@protocol"
import { HistoryPageOutcome } from "../src/entities/session/config/session-values"
import { settleHistoryEdge } from "../src/pages/session/lib/history/history-edges"

const open = { before: null, after: null }

describe("history edges", () => {
  it.each([HistoryPageOutcome.Loaded, HistoryPageOutcome.Declined])("records the edge a %s request left in place", (outcome) => {
    expect(settleHistoryEdge(open, HistoryDirection.Before, "first", outcome)).toEqual({ before: "first", after: null })
    expect(settleHistoryEdge(open, HistoryDirection.After, "last", outcome)).toEqual({ before: null, after: "last" })
  })

  it.each([HistoryPageOutcome.Failed, undefined])("keeps the edge open after a %s request", (outcome) => {
    expect(settleHistoryEdge(open, HistoryDirection.Before, "first", outcome)).toBe(open)
  })

  it("ignores the latest window and unknown edges", () => {
    expect(settleHistoryEdge(open, HistoryDirection.Latest, "last", HistoryPageOutcome.Loaded)).toBe(open)
    expect(settleHistoryEdge(open, HistoryDirection.Before, undefined, HistoryPageOutcome.Loaded)).toBe(open)
  })
})
