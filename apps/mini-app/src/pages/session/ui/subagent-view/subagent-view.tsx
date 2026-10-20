import { ArrowLeft } from "lucide-react"
import { HistoryStatus } from "@protocol"
import { SessionAvailability, SessionTab, agentName, sessionStatusLabel, sessionTitle, sourceTextClass } from "@/entities/session"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { NoticeTone, noticeVariants } from "@/shared/ui/notice"
import { SUBAGENT_VIEW_IDS } from "@/pages/session/config/test-ids"
import { SUBAGENT_STATUS_LABELS, SubagentHistoryStatus } from "@/pages/session/config/subagent"
import { SessionFeed } from "../session-feed/session-feed"
import type { SubagentViewProps } from "./subagent-view.types"

/** Read-only view of one subagent's transcript in the session feed renderer, tool calls included. */
export function SubagentView({ session, agentId, available, messages, status, error, onBack, onRetry, onHistoryPage }: SubagentViewProps) {
  const { t } = useTranslation()
  const agent = session.subagents?.find((candidate) => candidate.id === agentId)
  const empty = !messages.length
  const notice = empty && (status === SubagentHistoryStatus.Unavailable || status === SubagentHistoryStatus.Failed)

  const retry = onRetry ? (
    <Button variant="outline" size="sm" className="mt-[8px] block" data-testid={SUBAGENT_VIEW_IDS.retry} onClick={onRetry}>
      {t("subagentRetry")}
    </Button>
  ) : null

  return (
    <section
      className="session:flex session:min-h-0 session:flex-1 session:flex-col"
      data-testid={SUBAGENT_VIEW_IDS.root}
      data-agent-id={agentId}
    >
      <div className="flex items-center gap-[8px] pt-[8px] session:flex-none session:short:pt-[4px]">
        <Button
          variant="ghost"
          size="icon"
          className="size-[32px] flex-none p-0"
          data-testid={SUBAGENT_VIEW_IDS.back}
          aria-label={t("subagentBack")}
          title={t("subagentBack")}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={20} />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="mb-[2px] truncate text-[18px] session:text-[16px]" data-testid={SUBAGENT_VIEW_IDS.title}>
            {agent?.name ?? agent?.type ?? agentId}
          </h1>
          <p className={sourceTextClass}>
            {sessionTitle(session, 16) ?? t("selectedChat")} ·{" "}
            <span data-testid={SUBAGENT_VIEW_IDS.status}>
              {t("subagentStatus", { status: t(agent ? SUBAGENT_STATUS_LABELS[agent.status] : "statusUnknown") })}
            </span>
          </p>
        </div>
        <SessionAvailability available={available} />
      </div>
      <p
        className="mt-[6px] mb-[8px] truncate border-b border-border pb-[6px] text-[11px] text-muted-foreground session:flex-none session:short:hidden"
        data-testid={SUBAGENT_VIEW_IDS.task}
      >
        {agent?.task ?? agent?.description ?? t("subagentReadOnly")}
      </p>
      {!available ? (
        <p className={noticeVariants()} role="status" data-testid={SUBAGENT_VIEW_IDS.offline}>
          {t(sessionStatusLabel(session, available))}
        </p>
      ) : null}
      {notice && status === SubagentHistoryStatus.Unavailable ? (
        <div className={noticeVariants()} role="status" data-testid={SUBAGENT_VIEW_IDS.unavailable}>
          <strong className="block">{t("subagentTranscriptUnavailable")}</strong>
          {t("subagentTranscriptUnavailableHint")}
          {retry}
        </div>
      ) : notice ? (
        <div className={noticeVariants({ tone: NoticeTone.Error })} role="alert" data-testid={SUBAGENT_VIEW_IDS.error}>
          {feedbackText(error, t)}
          {retry}
        </div>
      ) : (
        <SessionFeed
          sessionId={session.id}
          onHistoryPage={onHistoryPage}
          agent={agentName(session)}
          messages={messages}
          historyStatus={status === SubagentHistoryStatus.Loading ? HistoryStatus.Loading : HistoryStatus.Ready}
          available={available}
          tab={SessionTab.History}
          terminal={null}
        />
      )}
    </section>
  )
}
