import { memo } from "react"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { SessionStatusTone, sessionFolder, sessionPath, sessionRecency, sessionStatusLabel, sessionStatusTone } from "@/entities/session"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import { relativeTime } from "@/widgets/session-sidebar/lib/sidebar-format"
import { rowTitle } from "@/widgets/session-sidebar/lib/sidebar-search"
import { rowDomId } from "@/widgets/session-sidebar/lib/row-dom-id"
import { ProviderIcon } from "./provider-icon"
import { HighlightMatch } from "./highlight-match"
import { SidebarPinButton } from "./sidebar-pin-button"
import type { SidebarRowProps } from "./list.types"

/** Memoized: rows re-render only when their session, selection, cursor, query, clock tick or attention changes. */
export const SidebarRow = memo(function SidebarRow({
  session,
  active,
  cursor,
  awaitingInput,
  query,
  now,
  onOpen,
  onTogglePin,
}: SidebarRowProps) {
  const { t, language } = useTranslation()
  const unavailable = sessionStatusTone(session, awaitingInput) === SessionStatusTone.Unavailable
  const project = sessionFolder(session)
  const title = rowTitle(session) ?? t("selectedChat")

  return (
    <div
      role="option"
      id={rowDomId(session.id)}
      aria-selected={active}
      data-testid={SESSION_SIDEBAR_IDS.row}
      data-session-id={session.id}
      data-cursor={cursor}
      className={cn(
        "group/row relative flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 select-none hover:bg-muted/45",
        active &&
          "bg-accent hover:bg-accent before:absolute before:inset-y-2 before:-left-2 before:w-[3px] before:rounded-r-full before:bg-primary",
        cursor && "ring-1 ring-primary/55 ring-inset",
      )}
      onClick={(event) => {
        if (onTogglePin && event.target instanceof Element && event.target.closest("[data-pin-control]")) onTogglePin(session)
        else onOpen(session)
      }}
    >
      <ProviderIcon session={session} awaitingInput={awaitingInput} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            data-testid={SESSION_SIDEBAR_IDS.rowTitle}
            title={title}
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-5",
              active ? "font-semibold" : "font-medium",
              unavailable && "text-muted-foreground",
            )}
          >
            <HighlightMatch text={title} query={query} />
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {session.lastMessageAt === undefined ? null : (relativeTime(sessionRecency(session), now, language) ?? t("sidebarNow"))}
          </span>
        </span>
        <span className="block truncate text-[11.5px] leading-4 text-muted-foreground" title={sessionPath(session) ?? undefined}>
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
      {session.pinned ? <span className="sr-only">{t("sidebarPinnedRow")}</span> : null}
      {onTogglePin ? <SidebarPinButton pinned={session.pinned === true} /> : null}
    </div>
  )
})
