import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { FrameType } from "@protocol"
import { AppTransport } from "../src/app/api/transport/app-transport"
import { RECONNECT_BACKOFF } from "../src/app/api/transport/reconnect-policy"

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

it("doubles the reconnect ceiling and starts again only after a connection stayed authenticated", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.999_999)
  const current = await connected()

  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs - 1)
  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs * 2 - 1)
  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs * 4 - 1)

  // Authenticated and dropped at once: still backing off.
  current().authenticate()
  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs * 8 - 1)

  // Authenticated for the stable minimum: the next drop starts from the base again.
  current().authenticate()
  await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF.StableMs)
  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs - 1)
})

it("never reconnects sooner than half the ceiling", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0)
  const current = await connected()

  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs / 2)
  expect(await reconnectDelay(current)).toBe(RECONNECT_BACKOFF.BaseMs)
})
