import type { KeyboardEvent, Ref } from "react"
import type { Session } from "@protocol"
import type { ProviderFilterValue } from "@/entities/session"

export interface SessionSidebarProps {
  sessions: Session[]
  activeId: string | null
  collapsed: boolean
  deviceOnline: boolean
  /** Reference time for grouping and relative labels; fixed in stories for deterministic output. */
  now?: number
  onOpen: (session: Session) => void
  onExpand: () => void
  onNewSession: () => void
}

export interface SidebarSearchProps {
  query: string
  inputRef: Ref<HTMLInputElement>
  onQuery: (value: string) => void
  onClear: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export interface SidebarProviderChipsProps {
  value: ProviderFilterValue
  onChange: (value: ProviderFilterValue) => void
}

export interface SidebarRailProps {
  sessions: Session[]
  activeId: string | null
  onOpen: (session: Session) => void
  onSearch: () => void
  onNewSession: () => void
}
