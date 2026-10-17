import { ConnectionStatus, ErrorCode } from "@protocol"
import type { SessionAuthentication } from "./session"
import type { TransportHandlers } from "../types"

export function isAuthenticationError(error: unknown) {
  return (
    error instanceof Error &&
    [ErrorCode.UNAUTHORIZED, ErrorCode.ACCESS_DENIED, ErrorCode.TELEGRAM_AUTH_FAILED].some((code) => code === error.message)
  )
}

export async function startSessionAuthentication(
  authentication: SessionAuthentication,
  initData: string,
  handlers: Pick<TransportHandlers, "onConnection">,
) {
  handlers.onConnection(ConnectionStatus.Connecting)

  try {
    await authentication.start(initData)
  } catch (error) {
    const expired = isAuthenticationError(error)

    handlers.onConnection(expired ? ConnectionStatus.Expired : ConnectionStatus.Offline)
    throw expired ? new Error(ErrorCode.TELEGRAM_AUTH_FAILED) : error
  }
}
