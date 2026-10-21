import type { ReactNode } from "react"
import type { Connection } from "@/shared/api"

export interface SettingsMenuProps {
  onAccounts?: (() => void) | undefined
  onUsage?: (() => void) | undefined
  onRules?: (() => void) | undefined
  /** Signs out after the owner confirms; the menu's last item. */
  onLogout: () => void
}

export interface ShellHeaderProps {
  connection: Connection
  onHome: () => void
  onLogout: () => void
  onAccounts?: (() => void) | undefined
  /** Opens Usage from the settings menu. */
  onUsage?: (() => void) | undefined
  /** Opens Rules from the settings menu. */
  onRules?: (() => void) | undefined
  /** Rendered before the brand, e.g. the desktop sidebar toggle. */
  leading?: ReactNode
  className?: string
}
