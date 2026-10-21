import { ConnectionStatus, DeviceStatus } from "@protocol"
import { AccountsPage } from "@/pages/accounts"
import { UsagePage } from "@/pages/usage"
import type { SessionState } from "@/entities/session"

interface DevicePageProps {
  /** Usage when true, else Accounts & keys. */
  usage: boolean
  deviceId: string
  state: SessionState
  onBack: () => void
}

/** The settings destinations that belong to the device rather than a session. */
export function DevicePage({ usage, deviceId, state, onBack }: DevicePageProps) {
  const online = state.connection === ConnectionStatus.Online && state.snapshot?.deviceStatus === DeviceStatus.Online

  return usage ? (
    <UsagePage deviceId={deviceId} online={online} sessions={state.snapshot?.sessions ?? []} onBack={onBack} />
  ) : (
    <AccountsPage deviceId={deviceId} online={online} onBack={onBack} />
  )
}
