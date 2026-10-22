import { afterEach, expect, it, vi } from "vitest"
import { HttpStatus } from "@protocol"
import { SessionAuthentication } from "@/shared/api"

afterEach(() => vi.unstubAllGlobals())

it("signs a linked client in and renews it with the credential it keeps, never with Telegram", async () => {
  const bodies: unknown[] = []

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      bodies.push([url, JSON.parse(String(init.body))])

      return new Response(JSON.stringify({ token: "synthetic-token", expiresAt: Date.now() + 900_000 }), { status: HttpStatus.Ok })
    }),
  )

  const logins: string[] = []

  const authentication = new SessionAuthentication(
    "https://relay.invalid",
    (login) => logins.push(login.token),
    () => undefined,
  )

  await authentication.start({ refresh: "synthetic-refresh" })
  await authentication.renew()
  authentication.close()

  expect(logins).toEqual(["synthetic-token", "synthetic-token"])

  expect(bodies).toEqual([
    ["https://relay.invalid/auth/refresh", { refresh: "synthetic-refresh" }],
    ["https://relay.invalid/auth/refresh", { refresh: "synthetic-refresh" }],
  ])
})
