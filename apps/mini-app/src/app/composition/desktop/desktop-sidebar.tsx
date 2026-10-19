import { memo } from "react"
import { ConnectionStatus, DeviceStatus, type Session } from "@protocol"
import { useSessionStore, useSessionsAwaitingInput } from "@/entities/session"
import { SessionSidebar } from "@/widgets/session-sidebar"
import type { DesktopSidebarProps } from "./desktop-layout.types"

const NO_SESSIONS: Session[] = []

/**
 * Subscribes only to what the list shows (sessions, selection, connection, device status, pending input), so message,
 * history and outbox updates do not re-render the sidebar. Callers pass stable callbacks.
 */
export const DesktopSidebar = memo(function DesktopSidebar({ accounts, collapsed, onOpen, onExpand, onNewSession }: DesktopSidebarProps) {
  const sessions = useSessionStore((state) => state.session.snapshot?.sessions) ?? NO_SESSIONS
  const selectedId = useSessionStore((state) => state.session.selectedId)
  const online = useSessionStore((state) => state.session.connection === ConnectionStatus.Online)
  const deviceOnline = useSessionStore((state) => state.session.snapshot?.deviceStatus === DeviceStatus.Online)
  const awaitingIds = useSessionsAwaitingInput()

  return (
    <SessionSidebar
      sessions={sessions}
      activeId={accounts ? null : selectedId}
      collapsed={collapsed}
      deviceOnline={online && deviceOnline}
      awaitingIds={awaitingIds}
      onOpen={onOpen}
      onExpand={onExpand}
      onNewSession={onNewSession}
    />
  )
})
