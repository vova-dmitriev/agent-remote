import type { ReactNode } from "react"
import type { Session } from "@protocol"
import type { SessionPageLoader } from "@/entities/session"
import type { SessionGroup } from "../lib/group-by-project"

export interface SessionsPageProps {
  sessions: Session[]
  connected: boolean
  loading: boolean
  onSelect: (session: Session) => void
  onLoadPage?: SessionPageLoader | undefined
  pageScope?: string | null
  creation?: ReactNode
  children: ReactNode
}

export interface SessionsPageListProps {
  sessions: Session[]
  connected: boolean
  loading: boolean
  pagesLoading: boolean
  pagesFailed: boolean
  hasMore: boolean
  searching: boolean
  onSelect: (session: Session) => void
  onLoadMore: () => void
  onRetry: () => void
}

export interface SessionSearchProps {
  query: string
  onQuery: (query: string) => void
}

export interface ProjectGroupProps {
  group: SessionGroup
  open: boolean
  awaiting: ReadonlySet<string>
  onToggle: (key: string) => void
  onSelect: (session: Session) => void
}
