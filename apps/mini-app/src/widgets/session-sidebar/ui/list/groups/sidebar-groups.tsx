import { useEffect, useRef } from "react"
import { PINNED_GROUP, sessionFolder } from "@/entities/session"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import { rowDomId } from "@/widgets/session-sidebar/lib/row-dom-id"
import { SidebarRow } from "../sidebar-row"
import type { SidebarGroupsProps } from "../list.types"
import { SidebarGroupHeader } from "./sidebar-group-header"

const LOAD_MORE_DISTANCE_PX = 100

export function SidebarGroups({
  sections,
  collapsedGroups,
  onToggleGroup,
  activeId,
  cursorId,
  query,
  now,
  awaitingIds,
  onOpen,
  onTogglePin,
  onKeyDown,
  onLoadMore,
  pagesLoading,
  pagesFailed,
  label,
}: SidebarGroupsProps) {
  const { t } = useTranslation()
  const list = useRef<HTMLDivElement>(null)

  const loadIfNearEnd = () => {
    const node = list.current

    if (node && node.scrollHeight - node.scrollTop - node.clientHeight < LOAD_MORE_DISTANCE_PX) onLoadMore?.()
  }

  // Collapsed groups can leave nothing to scroll, and older projects must still arrive. A failed page waits for the
  // retry button: retrying here would loop on every render.
  useEffect(() => {
    if (!pagesLoading && !pagesFailed) loadIfNearEnd()
  })

  return (
    <div
      ref={list}
      // The list holds the keyboard cursor; each project is a listbox of its own under its toggle, which no listbox may hold.
      role="group"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={cursorId ? rowDomId(cursorId) : undefined}
      data-testid={SESSION_SIDEBAR_IDS.list}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 [scrollbar-gutter:stable] outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
      onKeyDown={onKeyDown}
      onScroll={loadIfNearEnd}
    >
      {sections.map((section) => {
        const open = !collapsedGroups.has(section.key)
        const name = section.key === PINNED_GROUP ? t("sidebarPinned") : (section.name ?? t("sessionsNoProject"))

        return (
          <div
            key={section.key}
            role="group"
            aria-label={name}
            data-testid={SESSION_SIDEBAR_IDS.group}
            data-group={section.key}
            data-open={open}
          >
            <SidebarGroupHeader group={section} open={open} activeId={activeId} awaitingIds={awaitingIds} onToggle={onToggleGroup} />
            {open ? (
              <div role="listbox" aria-label={name}>
                {section.sessions.map((session) => (
                  <SidebarRow
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    cursor={session.id === cursorId}
                    awaitingInput={awaitingIds.has(session.id)}
                    query={query}
                    now={now}
                    // A search highlights matches in the project name, so the row keeps it then.
                    project={section.key !== PINNED_GROUP && !query.trim() ? null : sessionFolder(session)}
                    onOpen={onOpen}
                    onTogglePin={onTogglePin}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
