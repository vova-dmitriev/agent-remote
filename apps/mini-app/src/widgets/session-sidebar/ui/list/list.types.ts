import type { KeyboardEvent } from "react"
import type { Session } from "@protocol"
import type { SidebarSection } from "@/widgets/session-sidebar/lib/sidebar-groups"

export interface SidebarListProps {
  sections: SidebarSection[]
  activeId: string | null
  cursorId: string | null
  query: string
  now: number
  awaitingIds: ReadonlySet<string>
  onOpen: (session: Session) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onClear: () => void
}

export interface SidebarRowProps {
  session: Session
  active: boolean
  cursor: boolean
  awaitingInput: boolean
  query: string
  now: number
  onOpen: (session: Session) => void
}

export interface HighlightMatchProps {
  text: string
  query: string
}

export interface ProviderIconProps {
  session: Session
  awaitingInput: boolean
}
