import { ChevronDown, ChevronRight } from "lucide-react"
import { PINNED_GROUP, SessionStatusDot, UnreadBadge } from "@/entities/session"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import type { SidebarGroupHeaderProps } from "../list.types"

export function SidebarGroupHeader({ group, open, activeId, awaitingIds, onToggle }: SidebarGroupHeaderProps) {
  const { t } = useTranslation()
  const pinned = group.key === PINNED_GROUP
  const Chevron = open ? ChevronDown : ChevronRight
  const unread = group.sessions.reduce((total, session) => total + (session.id === activeId ? 0 : (session.unread ?? 0)), 0)
  // A collapsed group still tells that a session in it waits for an answer.
  const waiting = group.sessions.find((session) => awaitingIds.has(session.id))

  return (
    <button
      type="button"
      aria-expanded={open}
      title={pinned ? undefined : group.key}
      data-testid={SESSION_SIDEBAR_IDS.groupToggle}
      className="sticky top-0 z-10 flex w-full cursor-default items-center gap-1 bg-card px-2 pt-3 pb-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
      onClick={() => onToggle(group.key)}
      // Enter and arrows belong to this button here, not to the list's row cursor.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Chevron size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{pinned ? t("sidebarPinned") : (group.name ?? t("sessionsNoProject"))}</span>
      <span className="font-normal tabular-nums" data-testid={SESSION_SIDEBAR_IDS.groupCount}>
        {group.sessions.length}
      </span>
      {open ? null : (
        <span className="ml-auto flex items-center gap-1.5">
          <UnreadBadge count={unread} />
          {waiting ? <SessionStatusDot session={waiting} awaitingInput /> : null}
        </span>
      )}
    </button>
  )
}
