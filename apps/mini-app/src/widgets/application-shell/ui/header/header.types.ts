import type { ReactNode } from "react"
import type { Connection } from "@/shared/api"

export interface SettingsMenuProps {
  onAccounts: () => void
  onUsage?: (() => void) | undefined
}

export interface ShellHeaderProps {
  connection: Connection
  onHome: () => void
  onLogout: () => void
  onAccounts?: (() => void) | undefined
  /** Opens Usage from the settings menu. */
  onUsage?: (() => void) | undefined
  /** Rendered before the brand, e.g. the desktop sidebar toggle. */
  leading?: ReactNode
  className?: string
}
