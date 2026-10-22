import { ConnectionStatus, ErrorCode, FrameType } from "@protocol"
import type { LinkedCredential, SessionAuthentication } from "./session"
import type { TransportHandlers } from "../types"

export function isAuthenticationError(error: unknown) {
  return (
    error instanceof Error &&
    [ErrorCode.UNAUTHORIZED, ErrorCode.ACCESS_DENIED, ErrorCode.TELEGRAM_AUTH_FAILED].some((code) => code === error.message)
  )
}

export async function startSessionAuthentication(
  authentication: SessionAuthentication,
  initData: string | LinkedCredential,
  handlers: TransportHandlers,
) {
  handlers.onConnection(ConnectionStatus.Connecting)

  try {
    await authentication.start(initData)
  } catch (error) {
    const expired = isAuthenticationError(error)

    const failure = expired ? new Error(ErrorCode.TELEGRAM_AUTH_FAILED) : error

    handlers.onFrame({ type: FrameType.Error, code: failure instanceof Error ? failure.message : ErrorCode.REQUEST_FAILED })
    handlers.onConnection(expired ? ConnectionStatus.Expired : ConnectionStatus.Offline)
    throw failure
  }
}
