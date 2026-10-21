import type { ReactNode } from "react"
import type { useApplication } from "@/app/model/use-application"
import type { useSubagentView } from "@/app/model/navigation/use-subagent-view"

export interface ApplicationContentProps {
  model: ReturnType<typeof useApplication>
  accounts: boolean
  usage: boolean
  subagent: ReturnType<typeof useSubagentView>
  back: () => void
  /** Back from Accounts or Usage to the sessions. */
  closeAccounts: () => void
  /** Shown while no session is selected: the session list, or the desktop placeholder / new-session pane. */
  home: ReactNode
  /** The session page back arrow; hidden in the desktop sidebar layout. */
  sessionBack?: boolean
}
