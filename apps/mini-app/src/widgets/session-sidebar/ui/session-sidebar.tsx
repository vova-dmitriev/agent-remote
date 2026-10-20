import { Laptop, SquarePen } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { SESSION_SIDEBAR_IDS } from "../config/test-ids"
import { useSessionSidebar } from "../model/use-session-sidebar"
import { useSidebarClock } from "../model/use-sidebar-clock"
import { SidebarSearch } from "./sidebar-search"
import { SidebarProviderChips } from "./sidebar-provider-chips"
import { SidebarRail } from "./sidebar-rail"
import { SidebarList } from "./list/sidebar-list"
import { SidebarResizeHandle } from "./resize/sidebar-resize-handle"
import { SidebarWidth } from "../config/values"
import type { SessionSidebarProps } from "./session-sidebar.types"

const NO_SESSIONS: ReadonlySet<string> = new Set()

export function SessionSidebar({
  sessions,
  activeId,
  collapsed,
  deviceOnline,
  now: fixedNow,
  awaitingIds = NO_SESSIONS,
  onOpen,
  onExpand,
  onNewSession,
  width = SidebarWidth.Default,
  onResize,
  onResetWidth,
}: SessionSidebarProps) {
  const { t } = useTranslation()
  const now = useSidebarClock(fixedNow)
  const model = useSessionSidebar({ sessions, activeId, now, collapsed, onOpen, onExpand })

  if (collapsed) {
    return (
      <SidebarRail
        sessions={model.order}
        activeId={activeId}
        awaitingIds={awaitingIds}
        onOpen={model.open}
        onSearch={model.requestSearch}
        onNewSession={onNewSession}
      />
    )
  }

  return (
    <aside
      aria-label={t("sidebarSessions")}
      data-testid={SESSION_SIDEBAR_IDS.root}
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-card"
      style={{ width }}
    >
      {onResize && onResetWidth ? <SidebarResizeHandle width={width} onResize={onResize} onReset={onResetWidth} /> : null}
      <div className="flex flex-col gap-2.5 px-3 pt-3 pb-1">
        <div data-testid={SESSION_SIDEBAR_IDS.device} className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
          <Laptop aria-hidden="true" size={14} />
          <span className="truncate font-medium text-foreground">{t("sidebarDevice")}</span>
          <span aria-hidden="true" className={cn("ml-1 size-1.5 rounded-full", deviceOnline ? "bg-status-ready" : "bg-status-muted")} />
          <span>{t(deviceOnline ? "online" : "offline")}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="justify-start border-border bg-card text-[13px]!"
          data-testid={SESSION_SIDEBAR_IDS.newSession}
          onClick={onNewSession}
        >
          <SquarePen aria-hidden="true" />
          {t("newSession")}
        </Button>
        <SidebarSearch
          query={model.query}
          inputRef={model.searchNode}
          onQuery={model.setQuery}
          onClear={model.clear}
          onKeyDown={model.onKeyDown}
        />
        <SidebarProviderChips value={model.provider} onChange={model.setProvider} />
      </div>
      <SidebarList
        sections={model.sections}
        activeId={activeId}
        cursorId={model.cursorId}
        query={model.query}
        now={now}
        awaitingIds={awaitingIds}
        onOpen={model.open}
        onKeyDown={model.onKeyDown}
        onClear={model.clear}
      />
    </aside>
  )
}
