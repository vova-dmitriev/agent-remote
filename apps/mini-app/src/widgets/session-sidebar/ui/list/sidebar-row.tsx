import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { SessionStatusTone, sessionStatusLabel, sessionStatusTone } from "@/entities/session"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import { relativeTime } from "@/widgets/session-sidebar/lib/sidebar-format"
import { projectName, rowTitle } from "@/widgets/session-sidebar/lib/sidebar-search"
import { sessionTime } from "@/widgets/session-sidebar/lib/sidebar-groups"
import { rowDomId } from "@/widgets/session-sidebar/lib/row-dom-id"
import { ProviderIcon } from "./provider-icon"
import { HighlightMatch } from "./highlight-match"
import type { SidebarRowProps } from "./list.types"

export function SidebarRow({ session, active, cursor, query, now, onOpen }: SidebarRowProps) {
  const { t, language } = useTranslation()
  const unavailable = sessionStatusTone(session) === SessionStatusTone.Unavailable
  const project = projectName(session)

  return (
    <div
      role="option"
      id={rowDomId(session.id)}
      aria-selected={active}
      data-testid={SESSION_SIDEBAR_IDS.row}
      data-session-id={session.id}
      data-cursor={cursor}
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 select-none hover:bg-muted/45",
        active &&
          "bg-accent hover:bg-accent before:absolute before:inset-y-2 before:-left-2 before:w-[3px] before:rounded-r-full before:bg-primary",
        cursor && "ring-1 ring-primary/55 ring-inset",
      )}
      onClick={() => onOpen(session)}
    >
      <ProviderIcon session={session} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            data-testid={SESSION_SIDEBAR_IDS.rowTitle}
            className={cn(
              "truncate text-[13px] leading-5",
              active ? "font-semibold" : "font-medium",
              unavailable && "text-muted-foreground",
            )}
          >
            <HighlightMatch text={rowTitle(session) ?? t("selectedChat")} query={query} />
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {relativeTime(sessionTime(session), now, language) ?? t("sidebarNow")}
          </span>
        </span>
        <span className="block truncate text-[11.5px] leading-4 text-muted-foreground">
          {project ? (
            <>
              <HighlightMatch text={project} query={query} />
              {" · "}
            </>
          ) : null}
          <HighlightMatch text={session.model ?? t("modelUnknown")} query={query} />
        </span>
      </span>
      <span className="sr-only">{t(sessionStatusLabel(session))}</span>
    </div>
  )
}
