import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import { sidebarGroupLabels } from "@/widgets/session-sidebar/config/i18n-keys"
import { rowDomId } from "@/widgets/session-sidebar/lib/row-dom-id"
import { SidebarRow } from "../sidebar-row"
import type { SidebarGroupsProps } from "../list.types"

export function SidebarGroups({
  sections,
  activeId,
  cursorId,
  query,
  now,
  awaitingIds,
  onOpen,
  onTogglePin,
  onKeyDown,
  onLoadMore,
  label,
}: SidebarGroupsProps) {
  const { t } = useTranslation()

  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={cursorId ? rowDomId(cursorId) : undefined}
      data-testid={SESSION_SIDEBAR_IDS.list}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        const node = event.currentTarget

        if (node.scrollHeight - node.scrollTop - node.clientHeight < 100) onLoadMore?.()
      }}
    >
      {sections.map((section) => (
        <div
          key={section.group}
          role="group"
          aria-labelledby={`session-sidebar-group-${section.group}`}
          data-testid={SESSION_SIDEBAR_IDS.group}
          data-group={section.group}
        >
          <div
            id={`session-sidebar-group-${section.group}`}
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
              awaitingInput={awaitingIds.has(session.id)}
              query={query}
              now={now}
              onOpen={onOpen}
              onTogglePin={onTogglePin}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
