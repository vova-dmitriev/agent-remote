import { ConnectionStatus, DeviceStatus } from "@protocol"
import { AccountsPage } from "@/pages/accounts"
import { RulesPage } from "@/pages/rules"
import { UsagePage } from "@/pages/usage"
import type { SessionState } from "@/entities/session"
import { DeviceView } from "@/app/model/navigation/values"

interface DevicePageProps {
  page: DeviceView
  deviceId: string
  state: SessionState
  /** The session the page was opened from. */
  fromSession: string | null
  onBack: () => void
}

/** The settings destinations that belong to the device rather than a session. */
export function DevicePage({ page, deviceId, state, fromSession, onBack }: DevicePageProps) {
  const online = state.connection === ConnectionStatus.Online && state.snapshot?.deviceStatus === DeviceStatus.Online
  const sessions = state.snapshot?.sessions ?? []
  const session = sessions.find((item) => item.id === fromSession) ?? null

  if (page === DeviceView.Usage)
    return <UsagePage deviceId={deviceId} online={online} sessions={sessions} session={session} onBack={onBack} />

  if (page === DeviceView.Rules) return <RulesPage deviceId={deviceId} online={online} session={session} onBack={onBack} />

  return <AccountsPage deviceId={deviceId} online={online} onBack={onBack} />
}
