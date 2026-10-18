import { ErrorCode, HostKind } from "@protocol"
import { AppTransport } from "@/shared/api"
import { telegram } from "@/shared/lib/telegram"
import type { HostAdapter } from "./types"

export const telegramHost: HostAdapter = {
  kind: HostKind.Telegram,
  capabilities: { pairDevice: true, revokeDevice: true, fullTab: false },
  createClient(handlers) {
    const init = telegram()?.initData

    if (!init) throw new Error(ErrorCode.TELEGRAM_AUTH_FAILED)

    return new AppTransport(init, handlers)
  },
}
