import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { SESSION_CARD_IDS } from "../config/test-ids"
import { sourceNames, sessionTitle, agentName } from "../lib/labels"
import { sessionStatusLabel } from "../lib/availability"
import { sessionCardBodyClass, sessionCardClass } from "./session-class"
import { SessionStatusDot } from "./status-dot/status-dot"
import type { SessionCardProps } from "./session-card.types"

export function SessionCard({ session, onSelect, awaitingInput = false }: SessionCardProps) {
  const { t } = useTranslation()

  return (
    <Button
      variant="ghost"
      className={cn(sessionCardClass, "h-auto whitespace-normal")}
      data-testid={SESSION_CARD_IDS.root}
      data-session-id={session.id}
      onClick={() => onSelect(session)}
    >
      <div className={sessionCardBodyClass}>
        <span
          className="row-start-2 overflow-hidden text-[11px] leading-[16px] tracking-normal text-ellipsis whitespace-nowrap text-muted-foreground"
          data-testid={SESSION_CARD_IDS.source}
        >
          {agentName(session)} ·{" "}
          <span data-testid={SESSION_CARD_IDS.model} aria-label={t("modelLabel")} title={session.model ?? t("modelUnknown")}>
            {session.model ?? t("modelUnknown")}
          </span>{" "}
          · {t(sourceNames[session.target.kind])}
        </span>
        <strong
          className="col-span-full row-start-1 overflow-hidden text-[15px] leading-[20px] font-semibold text-ellipsis whitespace-nowrap"
          data-testid={SESSION_CARD_IDS.title}
        >
          {sessionTitle(session, 12) ?? t("selectedChat")}
        </strong>
        <span
          className="row-start-2 text-[11px] leading-[16px] whitespace-nowrap text-muted-foreground"
          data-testid={SESSION_CARD_IDS.status}
        >
          {t(sessionStatusLabel(session))}
        </span>
      </div>
      <SessionStatusDot session={session} awaitingInput={awaitingInput} />
    </Button>
  )
}
