import type { FocusEvent, KeyboardEvent } from "react"
import { AgentName } from "@/entities/session"
import type { HistoryMessage, HistoryPageDirection } from "@protocol"
import type { RailGroup, RailViewport } from "@/pages/session/lib/rail-layout"
import type { useMessagePreview } from "@/pages/session/model/use-message-preview"

export interface MessageRailProps {
  messages: HistoryMessage[]
  /** Virtual offset of every loaded message. */
  starts: readonly number[]
  /** Virtual size of the whole loaded feed. */
  total: number
  viewport: RailViewport
  activeId: string | null
  jump: (id: string) => void
  /** Scrolls the feed to a content offset. */
  seek: (offset: number) => void
  older: boolean
  newer: boolean
  loadPage: (direction: HistoryPageDirection) => void
  agent: AgentName
}

export interface HistoryCapProps {
  direction: HistoryPageDirection
  loadPage: (direction: HistoryPageDirection) => void
}

export interface RailMarkerProps {
  group: RailGroup
  messages: HistoryMessage[]
  agent: AgentName
  current: boolean
  preview: ReturnType<typeof useMessagePreview>
  register: (id: string, node: HTMLButtonElement | null) => void
  focus: { enter: (id: string) => void; leave: (event: FocusEvent<HTMLButtonElement>) => void }
  jump: (id: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}
