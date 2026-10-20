import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ErrorCode, HistoryDirection, type HistoryNavigationDirection } from "@protocol"
import { SubagentTranscript, type SubagentRead } from "../src/pages/session/model/subagent/subagent-transcript"
import { deferred, ids, page, visibility } from "./subagent-transcript-fixture"
import { SUBAGENT_POLL_BACKOFF_MAX_MS, SUBAGENT_POLL_INTERVAL_MS, SubagentHistoryStatus } from "../src/pages/session/config/subagent"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("ignores a slow read of a replaced window: the new generation's state stays intact", async () => {
  const slow = deferred()
  const current = new SubagentTranscript(async () => page("new-1"), visibility)
  const notified = vi.fn()

  const read = vi.fn(() => slow.promise)
  const previous = new SubagentTranscript(read, visibility)

  previous.subscribe(notified)
  previous.start(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(read).toHaveBeenCalledTimes(1)
  previous.stop()
  current.start(true)
  await vi.advanceTimersByTimeAsync(0)
  slow.resolve(page("old-1", "old-2"))
  await vi.advanceTimersByTimeAsync(0)

  expect(ids(current)).toEqual(["new-1"])
  expect(ids(previous)).toEqual([])
  expect(notified).not.toHaveBeenCalled()
  current.stop()
})

it("runs reads one at a time and skips a poll while another read is pending", async () => {
  const calls: HistoryNavigationDirection[] = []
  const gates: ReturnType<typeof deferred>[] = []
  let active = 0
  let overlap = false

  const read: SubagentRead = (direction) => {
    calls.push(direction)
    overlap ||= ++active > 1
    const gate = deferred()

    gates.push(gate)

    return gate.promise.finally(() => --active)
  }

  const transcript = new SubagentTranscript(read, visibility)

  transcript.start(true)
  void transcript.page(HistoryDirection.Before)
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS * 3)
  expect(calls).toEqual([HistoryDirection.Latest])
  gates[0]!.resolve(page("b", "c"))
  await vi.advanceTimersByTimeAsync(0)
  expect(calls).toEqual([HistoryDirection.Latest, HistoryDirection.Before])
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS * 2)
  expect(calls).toHaveLength(2)
  gates[1]!.resolve(page("a"))
  await vi.advanceTimersByTimeAsync(0)
  expect(calls).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS)
  expect(calls).toHaveLength(3)
  expect(overlap).toBe(false)
  expect(ids(transcript)).toEqual(["a", "b", "c"])
  transcript.stop()
})

it("backs off exponentially after consecutive failures, capped, and recovers after a success", async () => {
  let fail = true
  const read = vi.fn(async () => (fail ? Promise.reject(new Error(ErrorCode.SERVICE_UNAVAILABLE)) : page("a")))
  const transcript = new SubagentTranscript(read, visibility)
  const times: number[] = []

  read.mockImplementation(async () => {
    times.push(Date.now())

    return fail ? Promise.reject(new Error(ErrorCode.SERVICE_UNAVAILABLE)) : page("a")
  })

  transcript.start(true)
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_BACKOFF_MAX_MS * 4)
  const gaps = times.slice(1).map((time, index) => time - times[index]!)

  expect(gaps.slice(0, 4)).toEqual(
    [2, 4, 8, 16].map((factor) => Math.min(SUBAGENT_POLL_INTERVAL_MS * factor, SUBAGENT_POLL_BACKOFF_MAX_MS)),
  )

  expect(Math.max(...gaps)).toBe(SUBAGENT_POLL_BACKOFF_MAX_MS)
  expect(transcript.getSnapshot()).toMatchObject({ status: SubagentHistoryStatus.Failed, error: ErrorCode.SERVICE_UNAVAILABLE })
  fail = false
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_BACKOFF_MAX_MS)
  const recovered = times.length

  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS)
  expect(times.length).toBe(recovered + 1)
  expect(transcript.getSnapshot().status).toBe(SubagentHistoryStatus.Ready)
  transcript.stop()
})

it("stops polling an unavailable transcript until the user retries or the subagent list changes", async () => {
  let unavailable = true
  const read = vi.fn(async () => (unavailable ? Promise.reject(new Error(ErrorCode.TRANSCRIPT_UNAVAILABLE)) : page("a")))
  const transcript = new SubagentTranscript(read, visibility)

  transcript.start(true)
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS * 5)
  expect(read).toHaveBeenCalledTimes(1)
  expect(transcript.getSnapshot().status).toBe(SubagentHistoryStatus.Unavailable)

  transcript.resume()
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS * 5)
  expect(read).toHaveBeenCalledTimes(2)

  unavailable = false
  transcript.retry()
  expect(transcript.getSnapshot().status).toBe(SubagentHistoryStatus.Loading)
  await vi.advanceTimersByTimeAsync(0)
  expect(transcript.getSnapshot().status).toBe(SubagentHistoryStatus.Ready)
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS)
  expect(read).toHaveBeenCalledTimes(4)
  transcript.stop()
})

it("keeps shown items when a later read fails and replaces them with a non-overlapping latest page", async () => {
  const pages = [page("a", "b"), page("x", "y")]
  const read = vi.fn(async () => pages.shift() ?? Promise.reject(new Error(ErrorCode.SERVICE_UNAVAILABLE)))
  const transcript = new SubagentTranscript(read, visibility)

  transcript.start(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(ids(transcript)).toEqual(["a", "b"])
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS)
  expect(ids(transcript)).toEqual(["x", "y"])
  await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_INTERVAL_MS)
  expect(transcript.getSnapshot()).toMatchObject({ status: SubagentHistoryStatus.Ready, error: "" })
  expect(ids(transcript)).toEqual(["x", "y"])
  transcript.stop()
})
