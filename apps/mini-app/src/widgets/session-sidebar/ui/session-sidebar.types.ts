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
  /** Sessions with a pending permission or question; they wear the attention tone. */
  awaitingIds?: ReadonlySet<string>
  onOpen: (session: Session) => void
  onExpand: () => void
  onNewSession: () => void
  /** Expanded width in px; the sidebar is resizable when `onResize` is given. */
  width?: number
  onResize?: (width: number, done: boolean) => void
  onResetWidth?: () => void
}

export interface SidebarResizeHandleProps {
  width: number
  /** `done` is false while the pointer moves and true when the drag or key press ends. */
  onResize: (width: number, done: boolean) => void
  onReset: () => void
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
  awaitingIds: ReadonlySet<string>
  onOpen: (session: Session) => void
  onSearch: () => void
  onNewSession: () => void
}
