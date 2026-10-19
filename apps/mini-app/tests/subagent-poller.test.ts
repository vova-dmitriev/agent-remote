import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SubagentPoller } from "../src/pages/session/model/subagent/subagent-poller"

const INTERVAL = 1_000

class FakeVisibility extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible"

  set(state: DocumentVisibilityState) {
    this.visibilityState = state
    this.dispatchEvent(new Event("visibilitychange"))
  }
}

function poller(live = true) {
  const visibility = new FakeVisibility()
  const refresh = vi.fn(async () => undefined)
  const instance = new SubagentPoller({ refresh, interval: INTERVAL, live, visibility: visibility as unknown as Document })

  return { visibility, refresh, instance }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("reads once on start and then every interval while live and visible", async () => {
  const { refresh, instance } = poller()

  instance.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(refresh).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(INTERVAL * 3)
  expect(refresh).toHaveBeenCalledTimes(4)
  instance.stop()
})

it("reads a finished subagent once and does not poll", async () => {
  const { refresh, instance } = poller(false)

  instance.start()
  await vi.advanceTimersByTimeAsync(INTERVAL * 5)
  expect(refresh).toHaveBeenCalledTimes(1)
  instance.stop()
})

it("stops on unmount: no further reads and the visibility listener is removed", async () => {
  const { visibility, refresh, instance } = poller()

  instance.start()
  await vi.advanceTimersByTimeAsync(INTERVAL)
  expect(refresh).toHaveBeenCalledTimes(2)
  instance.stop()
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(INTERVAL * 5)
  visibility.set("hidden")
  visibility.set("visible")
  await vi.advanceTimersByTimeAsync(INTERVAL * 5)
  expect(refresh).toHaveBeenCalledTimes(2)
})

it("does not schedule another read when stopped while a read is in flight", async () => {
  const { visibility } = poller()

  let finish = () => {}

  const refresh = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
  const instance = new SubagentPoller({ refresh, interval: INTERVAL, live: true, visibility: visibility as unknown as Document })

  instance.start()
  instance.stop()
  finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(INTERVAL * 5)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it("pauses while the page is hidden and reads at once when it is shown again", async () => {
  const { visibility, refresh, instance } = poller()

  instance.start()
  await vi.advanceTimersByTimeAsync(0)
  visibility.set("hidden")
  await vi.advanceTimersByTimeAsync(INTERVAL * 5)
  expect(refresh).toHaveBeenCalledTimes(1)
  visibility.set("visible")
  await vi.advanceTimersByTimeAsync(0)
  expect(refresh).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(INTERVAL)
  expect(refresh).toHaveBeenCalledTimes(3)
  instance.stop()
})

it("does not start polling a finished subagent when the page is shown again", async () => {
  const { visibility, refresh, instance } = poller(false)

  instance.start()
  await vi.advanceTimersByTimeAsync(0)
  visibility.set("hidden")
  visibility.set("visible")
  await vi.advanceTimersByTimeAsync(INTERVAL * 3)
  expect(refresh).toHaveBeenCalledTimes(1)
  instance.stop()
})

it("keeps polling after a failed read", async () => {
  const { visibility } = poller()
  const refresh = vi.fn(async () => Promise.reject(new Error("SERVICE_UNAVAILABLE")))
  const instance = new SubagentPoller({ refresh, interval: INTERVAL, live: true, visibility: visibility as unknown as Document })

  instance.start()
  await vi.advanceTimersByTimeAsync(INTERVAL * 2)
  expect(refresh).toHaveBeenCalledTimes(3)
  instance.stop()
})
