import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ErrorCode, HistoryDirection } from "@protocol"
import { HistoryPageOutcome } from "../src/entities/session/config/session-values"
import { HistoryPageSkip } from "../src/shared/api"
import { SubagentTranscript } from "../src/pages/session/model/subagent/subagent-transcript"
import { SUBAGENT_POLL_INTERVAL_MS, SubagentHistoryStatus } from "../src/pages/session/config/subagent"
import { gatedRead, ids, page, visibility } from "./subagent-transcript-fixture"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("loads the final lines when the subagent finishes while a poll is in flight", async () => {
  const { gates, read } = gatedRead()
  const transcript = new SubagentTranscript(read, visibility)

  transcript.start(true)
  await vi.advanceTimersByTimeAsync(0)
  gates[0]!.resolve(page("a"))
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS)
  expect(read).toHaveBeenCalledTimes(2)

  transcript.start(false)
  gates[1]!.resolve(page("a", "b"))
  await vi.advanceTimersByTimeAsync(0)
  expect(read).toHaveBeenCalledTimes(3)
  gates[2]!.resolve(page("a", "b", "c"))
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS * 3)
  expect(ids(transcript)).toEqual(["a", "b", "c"])
  expect(read).toHaveBeenCalledTimes(3)
  transcript.stop()
})

it("performs a read when the user retries while a read is in flight", async () => {
  const { gates, read } = gatedRead()
  const transcript = new SubagentTranscript(read, visibility)

  transcript.start(true)
  await vi.advanceTimersByTimeAsync(0)
  transcript.retry()
  gates[0]!.reject(new Error(ErrorCode.SERVICE_UNAVAILABLE))
  await vi.advanceTimersByTimeAsync(0)
  expect(read).toHaveBeenCalledTimes(2)
  gates[1]!.resolve(page("a"))
  await vi.advanceTimersByTimeAsync(0)
  expect(transcript.getSnapshot()).toMatchObject({ status: SubagentHistoryStatus.Ready, error: "" })
  expect(ids(transcript)).toEqual(["a"])
  transcript.stop()
})

it("treats skipped and stale pages as no-ops and reports them like the parent feed", async () => {
  const results = [page("a"), HistoryPageSkip.Busy, HistoryPageSkip.Exhausted, HistoryPageSkip.Stale, null]
  const transcript = new SubagentTranscript(async () => results.shift() ?? null, visibility)

  transcript.start(false)
  await vi.advanceTimersByTimeAsync(0)
  const loaded = transcript.getSnapshot()

  expect(await transcript.page(HistoryDirection.Before)).toBe(HistoryPageOutcome.Busy)
  expect(await transcript.page(HistoryDirection.Before)).toBe(HistoryPageOutcome.Declined)
  expect(await transcript.page(HistoryDirection.Before)).toBe(HistoryPageOutcome.Stale)
  expect(await transcript.page(HistoryDirection.Latest)).toBe(HistoryPageOutcome.Stale)
  expect(transcript.getSnapshot()).toBe(loaded)
  expect(ids(transcript)).toEqual(["a"])
  transcript.stop()
})
