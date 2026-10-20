import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { FrameType } from "@protocol"
import { AppTransport } from "../src/app/api/transport/app-transport"
import { RECONNECT_BACKOFF, ReconnectBackoff } from "../src/app/api/transport/reconnect-backoff"

const ABNORMAL_CLOSE = 1006

class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor() {
    FakeSocket.instances.push(this)
  }

  send() {}

  close() {}

  drop() {
    this.onclose?.({ code: ABNORMAL_CLOSE })
  }

  authenticate() {
    this.onmessage?.({ data: JSON.stringify({ type: FrameType.Authenticated }) })
  }
}

let transport: AppTransport | undefined

beforeEach(() => {
  FakeSocket.instances = []
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", FakeSocket)

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ token: "synthetic-token", expiresAt: Date.now() + 3_600_000 })),
  )
})

afterEach(() => {
  transport?.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function connected() {
  transport = new AppTransport("synthetic-init-data", { onConnection: () => {}, onFrame: () => {} }, "http://relay.invalid")
  await transport.start()

  return () => FakeSocket.instances.at(-1)!
}

/** Drops the current socket and returns how long the transport waits before it opens the next one. */
async function reconnectDelay(current: () => FakeSocket) {
  const before = FakeSocket.instances.length

  current().drop()

  for (let waited = 0; waited <= RECONNECT_BACKOFF.MaxMs; waited++) {
    if (FakeSocket.instances.length > before) return waited

    await vi.advanceTimersByTimeAsync(1)
  }

  throw new Error("NO_RECONNECT")
}

it("doubles the reconnect ceiling up to the cap and starts again after a successful authentication", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.999_999)
  const current = await connected()

  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs - 1)
  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs * 2 - 1)
  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs * 4 - 1)

  current().authenticate()
  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs - 1)
})

it("spreads reconnects uniformly below the ceiling", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.25)
  const current = await connected()

  expect(await reconnectDelay(current)).toBe(Math.floor(RECONNECT_BACKOFF.BaseMs * 0.25))
  expect(await reconnectDelay(current)).toBe(Math.floor(RECONNECT_BACKOFF.BaseMs * 2 * 0.25))
})

it("never waits longer than the cap", () => {
  const backoff = new ReconnectBackoff(() => 0.999_999)
  const delays = Array.from({ length: 12 }, () => backoff.next())

  expect(Math.max(...delays)).toBeLessThan(RECONNECT_BACKOFF.MaxMs)
  expect(delays.at(-1)).toBe(Math.floor(RECONNECT_BACKOFF.MaxMs * 0.999_999))
  expect(new ReconnectBackoff(() => 0).next()).toBe(0)
})
