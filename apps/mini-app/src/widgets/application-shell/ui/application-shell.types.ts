import type { ReactNode } from "react"
import type { Connection } from "@/shared/api"

export interface ApplicationShellProps {
  connection: Connection
  result: string
  onHome: () => void
  onLogout: () => void
  /** Opens Accounts & keys from the settings menu; the menu is hidden while no device can host accounts. */
  onAccounts?: (() => void) | undefined
  children: ReactNode
  compact?: boolean
}
