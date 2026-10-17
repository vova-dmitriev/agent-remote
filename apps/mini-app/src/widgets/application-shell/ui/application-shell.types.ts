import type { ReactNode } from "react"
import type { Connection } from "@/shared/api"

export interface ApplicationShellProps {
  connection: Connection
  result: string
  onHome: () => void
  onLogout: () => void
  children: ReactNode
  compact?: boolean
}
