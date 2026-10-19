import { SearchX } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { mutedTextClass } from "@/shared/ui/text"
import { cn } from "@/shared/lib/utils"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import { sidebarGroupLabels } from "@/widgets/session-sidebar/config/i18n-keys"
import { rowDomId } from "@/widgets/session-sidebar/lib/row-dom-id"
import { SidebarRow } from "./sidebar-row"
import type { SidebarListProps } from "./list.types"

export function SidebarList({ sections, activeId, cursorId, query, now, onOpen, onKeyDown, onClear }: SidebarListProps) {
  const { t } = useTranslation()

  if (!sections.length && !query.trim()) {
    return (
      <p data-testid={SESSION_SIDEBAR_IDS.empty} className={cn(mutedTextClass, "px-5 pt-6 text-center")}>
        {t("connectSession")}
      </p>
    )
  }

  if (!sections.length) {
    return (
      <div data-testid={SESSION_SIDEBAR_IDS.empty} className="flex flex-1 flex-col items-center gap-2 px-6 pt-12 text-center">
        <SearchX aria-hidden="true" size={22} className="text-muted-foreground" />
        <p className="max-w-full text-[13px] font-medium break-words">{t("sidebarNoMatches", { query: query.trim() })}</p>
        <p className="text-xs text-muted-foreground">{t("sidebarNoMatchesHint")}</p>
        <Button variant="ghost" size="sm" className="mt-1 text-xs!" onClick={onClear}>
          {t("sidebarClearSearch")}
        </Button>
      </div>
    )
  }

  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label={t("sidebarSessions")}
      aria-activedescendant={cursorId ? rowDomId(cursorId) : undefined}
      data-testid={SESSION_SIDEBAR_IDS.list}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
      onKeyDown={onKeyDown}
    >
      {sections.map((section) => (
        <div
          key={section.group}
          role="group"
          aria-labelledby={"session-sidebar-group-" + section.group}
          data-testid={SESSION_SIDEBAR_IDS.group}
          data-group={section.group}
        >
          <div
            id={"session-sidebar-group-" + section.group}
            className="sticky top-0 z-10 bg-card px-2 pt-3 pb-1 text-[11px] font-medium text-muted-foreground"
          >
            {t(sidebarGroupLabels[section.group])}
          </div>
          {section.sessions.map((session) => (
            <SidebarRow
              key={session.id}
              session={session}
              active={session.id === activeId}
              cursor={session.id === cursorId}
              query={query}
              now={now}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
