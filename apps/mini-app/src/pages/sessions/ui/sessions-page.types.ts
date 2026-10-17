import type { ReactNode } from "react"
import type { Session } from "@protocol"

export interface SessionsPageProps {
  sessions: Session[]
  connected: boolean
  loading: boolean
  onSelect: (session: Session) => void
  creation?: ReactNode
  children: ReactNode
}
