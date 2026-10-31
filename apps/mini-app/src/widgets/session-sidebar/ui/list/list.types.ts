import type { KeyboardEvent } from "react"
import type { Session } from "@protocol"
import type { SessionGroup } from "@/entities/session"

export interface SidebarListProps {
  sections: SessionGroup[]
  collapsedGroups: ReadonlySet<string>
  onToggleGroup: (key: string) => void
  activeId: string | null
  cursorId: string | null
  query: string
  now: number
  awaitingIds: ReadonlySet<string>
  onOpen: (session: Session) => void
  onTogglePin?: ((session: Session) => void) | undefined
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onClear: () => void
  onLoadMore?: () => void
  pagesLoading?: boolean
  pagesFailed?: boolean
  onRetryPages?: () => void
}

export interface SidebarGroupsProps {
  sections: SessionGroup[]
  collapsedGroups: ReadonlySet<string>
  onToggleGroup: (key: string) => void
  activeId: string | null
  cursorId: string | null
  query: string
  now: number
  awaitingIds: ReadonlySet<string>
  onOpen: (session: Session) => void
  onTogglePin?: ((session: Session) => void) | undefined
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onLoadMore?: () => void
  pagesLoading?: boolean
  pagesFailed?: boolean
  label: string
}

export interface SidebarPageStatusProps {
  loading: boolean
  failed: boolean
  onRetry?: (() => void) | undefined
}

export interface SidebarRowProps {
  session: Session
  active: boolean
  cursor: boolean
  awaitingInput: boolean
  query: string
  now: number
  /** Null when the group above the row already names the project. */
  project: string | null
  onOpen: (session: Session) => void
  onTogglePin?: ((session: Session) => void) | undefined
}

export interface SidebarGroupHeaderProps {
  group: SessionGroup
  open: boolean
  activeId: string | null
  awaitingIds: ReadonlySet<string>
  onToggle: (key: string) => void
}

export interface SidebarPinButtonProps {
  pinned: boolean
}

export interface HighlightMatchProps {
  text: string
  query: string
}

export interface ProviderIconProps {
  session: Session
  awaitingInput: boolean
}
