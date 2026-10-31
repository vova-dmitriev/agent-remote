import { ChevronDown, ChevronRight } from "lucide-react"
import { PINNED_GROUP, SessionCard, SessionStatusDot, UnreadBadge } from "@/entities/session"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { ProjectGroupProps } from "@/pages/sessions/ui/sessions-page.types"

export function ProjectGroup({ group, open, awaiting, onToggle, onSelect }: ProjectGroupProps) {
  const { t } = useTranslation()
  const pinned = group.key === PINNED_GROUP
  const Chevron = open ? ChevronDown : ChevronRight
  const unread = group.sessions.reduce((total, session) => total + (session.unread ?? 0), 0)
  // A collapsed group still tells that a session in it waits for an answer.
  const waiting = group.sessions.find((session) => awaiting.has(session.id))

  return (
    <div data-testid={SESSIONS_PAGE_IDS.group} data-group={group.key} data-open={open}>
      <Button
        variant="ghost"
        className="sticky top-0 z-10 h-auto w-full justify-start gap-[6px] rounded-none bg-background py-[8px] has-[>svg]:px-[4px] text-left text-[13px] font-semibold"
        aria-expanded={open}
        title={pinned ? undefined : group.key}
        data-testid={SESSIONS_PAGE_IDS.groupToggle}
        onClick={() => onToggle(group.key)}
      >
        <Chevron size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="truncate">{pinned ? t("sidebarPinned") : (group.name ?? t("sessionsNoProject"))}</span>
        <span className="text-[11px] font-normal text-muted-foreground tabular-nums" data-testid={SESSIONS_PAGE_IDS.groupCount}>
          {group.sessions.length}
        </span>
        {open ? null : (
          <span className="ml-auto flex items-center gap-[6px]">
            <UnreadBadge count={unread} />
            {waiting ? <SessionStatusDot session={waiting} awaitingInput /> : null}
          </span>
        )}
      </Button>
      {open
        ? group.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              awaitingInput={awaiting.has(session.id)}
              hideFolder={!pinned}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  )
}
