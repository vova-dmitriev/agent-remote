import { SessionStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSION_CARD_IDS } from "../config/test-ids"
import { sourceNames, sessionTitle, agentName } from "../lib/labels"
import { sessionStatusLabel, sourceObserved } from "../lib/availability"
import type { SessionCardProps } from "./session-card.types"

export function SessionCard({ session, onSelect }: SessionCardProps) {
  const { t } = useTranslation()

  return (
    <Button
      variant="ghost"
      className="session-card h-auto whitespace-normal"
      data-testid={SESSION_CARD_IDS.root}
      data-session-id={session.id}
      onClick={() => onSelect(session)}
    >
      <div>
        <span className="source" data-testid={SESSION_CARD_IDS.source}>
          {agentName(session)} ·{" "}
          <span data-testid={SESSION_CARD_IDS.model} aria-label={t("modelLabel")} title={session.model ?? t("modelUnknown")}>
            {session.model ?? t("modelUnknown")}
          </span>{" "}
          · {t(sourceNames[session.target.kind])}
        </span>
        <strong data-testid={SESSION_CARD_IDS.title}>{sessionTitle(session, 12) ?? t("selectedChat")}</strong>
        <span className="status" data-testid={SESSION_CARD_IDS.status}>
          {t(sessionStatusLabel(session))}
        </span>
      </div>
      <span className={"status-dot " + (sourceObserved(session) ? session.status : SessionStatus.Unknown)} />
    </Button>
  )
}
