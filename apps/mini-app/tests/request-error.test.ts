import { describe, expect, it } from "vitest"
import { ErrorCode, HttpStatus } from "@protocol"
import { responseError } from "../src/shared/api/request-error"

describe("responseError", () => {
  it("keeps the body code of an internal error over the status fallback", async () => {
    const error = await responseError(Response.json({ code: ErrorCode.INTERNAL_ERROR }, { status: HttpStatus.InternalServerError }))

    expect(error.message).toBe(ErrorCode.INTERNAL_ERROR)
    expect(error.status).toBe(HttpStatus.InternalServerError)
  })

  it("falls back to service unavailability for a server error without a code", async () => {
    const error = await responseError(new Response("", { status: HttpStatus.InternalServerError }))

    expect(error.message).toBe(ErrorCode.SERVICE_UNAVAILABLE)
  })
})
