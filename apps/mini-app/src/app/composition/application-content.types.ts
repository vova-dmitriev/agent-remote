import type { ReactNode } from "react"
import type { useApplication } from "@/app/model/use-application"

export interface ApplicationContentProps {
  model: ReturnType<typeof useApplication>
  accounts: boolean
  back: () => void
  closeAccounts: () => void
  /** Shown while no session is selected: the session list, or the desktop placeholder / new-session pane. */
  home: ReactNode
  /** The session page back arrow; hidden in the desktop sidebar layout. */
  sessionBack?: boolean
}
