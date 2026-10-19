import type { ReactNode } from "react"
import type { Connection } from "@/shared/api"

export interface SettingsMenuProps {
  onAccounts: () => void
}

export interface ShellHeaderProps {
  connection: Connection
  onHome: () => void
  onLogout: () => void
  onAccounts?: (() => void) | undefined
  /** Rendered before the brand, e.g. the desktop sidebar toggle. */
  leading?: ReactNode
  className?: string
}
