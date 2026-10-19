import { Search, SquarePen } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { SESSION_SIDEBAR_IDS } from "../config/test-ids"
import { rowTitle } from "../lib/sidebar-search"
import { ProviderIcon } from "./list/provider-icon"
import type { SidebarRailProps } from "./session-sidebar.types"

export function SidebarRail({ sessions, activeId, awaitingIds, onOpen, onSearch, onNewSession }: SidebarRailProps) {
  const { t } = useTranslation()

  return (
    <nav
      aria-label={t("sidebarSessions")}
      data-testid={SESSION_SIDEBAR_IDS.rail}
      className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-card pt-3"
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("sidebarSearch")}
        title={t("sidebarSearch") + " " + t("sidebarShortcut")}
        data-testid={SESSION_SIDEBAR_IDS.railSearch}
        onClick={onSearch}
      >
        <Search aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("newSession")}
        title={t("newSession")}
        data-testid={SESSION_SIDEBAR_IDS.railNewSession}
        onClick={onNewSession}
      >
        <SquarePen aria-hidden="true" />
      </Button>
      <span aria-hidden="true" className="my-1 h-px w-6 bg-border" />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto pb-3">
        {sessions.map((session) => {
          const title = rowTitle(session) ?? t("selectedChat")

          return (
            <Button
              key={session.id}
              variant="ghost"
              size="icon"
              aria-label={title}
              aria-current={session.id === activeId}
              title={title}
              data-testid={SESSION_SIDEBAR_IDS.railRow}
              data-session-id={session.id}
              className={cn("relative", session.id === activeId && "bg-accent")}
              onClick={() => onOpen(session)}
            >
              <ProviderIcon session={session} awaitingInput={awaitingIds.has(session.id)} />
            </Button>
          )
        })}
      </div>
    </nav>
  )
}
