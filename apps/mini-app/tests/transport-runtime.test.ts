import { afterEach, expect, it } from "vitest"
import { ConnectionStatus } from "@protocol"
import { AppTransport } from "../src/app/api/transport/app-transport"
import { createSessionStore } from "../src/entities/session/model/store/create-session-store"

const clients: AppTransport[] = []

function client() {
  const transport = new AppTransport("synthetic", { onConnection: () => {}, onFrame: () => {} })

  clients.push(transport)

  return transport
}

afterEach(() => {
  for (const transport of clients.splice(0)) transport.close()
})

it("invalidates a pending operation when its application logs out and cannot restore its client", async () => {
  const runtime = createSessionStore().getState().runtime

  expect(runtime).toBeDefined()
  if (!runtime) return
  const lease = runtime.attach(client())
  let complete!: () => void
  let result = ""

  const pending = new Promise<void>((resolve) => {
    complete = resolve
  }).then(() => {
    if (runtime.isCurrent(lease)) result = "stale completion"
  })

  expect(runtime.isCurrent(lease)).toBe(true)
  expect(runtime.clear()).toBe(lease.client)
  complete()
  await pending
  expect(result).toBe("")
  expect(runtime.client).toBeNull()
  expect(runtime.isCurrent(lease)).toBe(false)
})

it("an old effect cleanup cannot detach a replacement connection or another app instance", () => {
  const first = createSessionStore().getState().runtime
  const second = createSessionStore().getState().runtime

  expect(first).toBeDefined()
  expect(second).toBeDefined()
  if (!first || !second) return
  const old = first.attach(client())
  const replacement = first.attach(client())
  const other = second.attach(client())

  expect(first.clear(old)).toBeNull()
  expect(first.current()).toBe(replacement)
  expect(first.isCurrent(old)).toBe(false)
  expect(first.isCurrent(other)).toBe(false)
  first.clear()
  expect(second.isCurrent(other)).toBe(true)
  expect(second.client).toBe(other.client)
})

it("auth expiry invalidates pending callbacks before publishing the cleared owner state", async () => {
  const store = createSessionStore()
  const runtime = store.getState().runtime
  const lease = runtime.attach(client())
  let complete!: () => void

  const pending = new Promise<void>((resolve) => {
    complete = resolve
  }).then(() => {
    if (runtime.isCurrent(lease)) store.getState().setError("STALE_REQUEST_TIMEOUT")
  })

  store.getState().setConnection(ConnectionStatus.Expired)
  complete()
  await pending
  expect(runtime.isCurrent(lease)).toBe(false)
  expect(runtime.client).toBeNull()
  expect(store.getState().error).toBe("")
})

it("device reset keeps the current offline status when a request started while online", () => {
  const store = createSessionStore()

  store.getState().setConnection(ConnectionStatus.Online)
  const finishRevocation = store.getState().resetDeviceState

  expect(finishRevocation).toBeTypeOf("function")
  if (!finishRevocation) return
  store.getState().setState((state) => ({ ...state, selectedId: "revoked-session" }))
  store.getState().setConnection(ConnectionStatus.Offline)
  finishRevocation()
  expect(store.getState().session.connection).toBe(ConnectionStatus.Offline)
  expect(store.getState().session.selectedId).toBeNull()
  expect(store.getState().session.messages).toEqual({})
})
