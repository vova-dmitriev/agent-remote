import type { ReactNode } from "react"
import type { useApplication } from "@/app/model/use-application"
import type { useSubagentView } from "@/app/model/navigation/use-subagent-view"
import type { DeviceView } from "@/app/model/navigation/values"

export interface ApplicationContentProps {
  model: ReturnType<typeof useApplication>
  /** The device's settings page that is open, if any. */
  device: DeviceView | null
  /** The session the open device page was opened from. */
  fromSession: string | null
  openRules: (sessionId: string) => void
  openUsage: (sessionId: string) => void
  subagent: ReturnType<typeof useSubagentView>
  back: () => void
  /** Back from a settings page to the sessions. */
  closeAccounts: () => void
  /** Shown while no session is selected: the session list, or the desktop placeholder / new-session pane. */
  home: ReactNode
  /** The session page back arrow; hidden in the desktop sidebar layout. */
  sessionBack?: boolean
}
