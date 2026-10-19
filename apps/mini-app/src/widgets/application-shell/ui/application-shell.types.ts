import type { ReactNode } from "react"
import type { Connection } from "@/shared/api"
import type { ShellHeaderProps } from "./header/header.types"

export interface ApplicationShellProps {
  connection: Connection
  result: string
  onHome: () => void
  onLogout: () => void
  /** Opens Accounts & keys from the settings menu; the menu is hidden while no device can host accounts. */
  onAccounts?: (() => void) | undefined
  children: ReactNode
  compact?: boolean
  /** Header and footer; the desktop sidebar layout renders its own app bar. */
  chrome?: boolean
}

export interface DesktopHeaderProps extends Omit<ShellHeaderProps, "leading" | "className"> {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}
