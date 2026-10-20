import { useState } from "react"
import { ConnectionStatus, type Session } from "@protocol"
import { DesktopHeader } from "@/widgets/application-shell"
import { SHELL_IDS } from "@/widgets/application-shell/config/test-ids"
import { DesktopPlaceholder } from "@/app/composition/desktop/desktop-placeholder"
import { SessionSidebar } from "@/widgets/session-sidebar"
import { SIDEBAR_NOW, sidebarSessions } from "../../fixtures/sidebar-sessions"
import { DesktopSessionPane } from "./desktop-session-pane"
import { DesktopAccountsPane } from "./desktop-accounts-pane"

/** Header ids re-exported for the sidebar stories, which may not import a sibling widget slice. */
export const DESKTOP_LAYOUT_IDS = { settings: SHELL_IDS.settings } as const

const DesktopView = { Sessions: "sessions", Accounts: "accounts" } as const

type DesktopView = (typeof DesktopView)[keyof typeof DesktopView]

interface DesktopLayoutStoryProps {
  sessions?: Session[]
  initialActiveId?: string | null
  initialCollapsed?: boolean
  /** Sessions shown pinned at first; the story pins and unpins locally. */
  initialPinnedIds?: string[]
}

/** Story-only composition of the desktop mode: app bar, session sidebar and the selected session. */
export function DesktopLayoutStory({
  sessions = sidebarSessions,
  initialActiveId = sidebarSessions[0]!.id,
  initialCollapsed = false,
  initialPinnedIds = [],
}: DesktopLayoutStoryProps) {
  const [activeId, setActiveId] = useState<string | null>(initialActiveId)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [view, setView] = useState<DesktopView>(DesktopView.Sessions)
  const [pinnedIds, setPinnedIds] = useState(() => new Set(initialPinnedIds))
  const shown = sessions.map((session) => (pinnedIds.has(session.id) ? { ...session, pinned: true as const } : session))
  const active = shown.find((session) => session.id === activeId)

  const togglePin = (session: Session) =>
    setPinnedIds((current) => {
      const next = new Set(current)

      if (!next.delete(session.id)) next.add(session.id)

      return next
    })

  return (
    <div className="flex h-dvh min-w-[960px] flex-col bg-background text-foreground">
      <DesktopHeader
        connection={ConnectionStatus.Online}
        sidebarCollapsed={collapsed}
        onToggleSidebar={() => setCollapsed((value) => !value)}
        onHome={() => setView(DesktopView.Sessions)}
        onAccounts={() => setView(DesktopView.Accounts)}
        onLogout={() => {}}
      />
      <div className="flex min-h-0 flex-1">
        <SessionSidebar
          sessions={shown}
          activeId={view === DesktopView.Sessions ? (active?.id ?? null) : null}
          collapsed={collapsed}
          deviceOnline
          now={SIDEBAR_NOW}
          onOpen={(session) => {
            setActiveId(session.id)
            setView(DesktopView.Sessions)
          }}
          onTogglePin={togglePin}
          onExpand={() => setCollapsed(false)}
          onNewSession={() => {}}
        />
        <div className="min-w-0 flex-1">
          {view === DesktopView.Accounts ? (
            <DesktopAccountsPane onBack={() => setView(DesktopView.Sessions)} />
          ) : active ? (
            <DesktopSessionPane key={active.id} session={active} sessions={sessions} onBack={() => setActiveId(null)} />
          ) : (
            <DesktopPlaceholder />
          )}
        </div>
      </div>
    </div>
  )
}
