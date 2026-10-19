import { ArrowLeft } from "lucide-react"
import { StatusConfidence, HistoryStatus, ConnectionStatus, DeviceStatus } from "@protocol"
import {
  SessionTab,
  SessionChanges,
  SessionAvailability,
  sourceNames,
  sessionStatusLabel,
  sessionTitle,
  agentName,
  sourceTextClass,
} from "@/entities/session"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { SessionTitle } from "@/features/rename-session"
import { SessionComposer, SessionActions } from "@/features/send-command"
import { Button } from "@/shared/ui/button"
import { noticeVariants } from "@/shared/ui/notice"
import { cn } from "@/shared/lib/utils"
import { SessionActivity } from "./activity/session-activity"
import { sessionObserved } from "../lib/session-availability"
import { SubagentPanel } from "./subagents/subagent-panel"
import { UserInputRequests } from "./questions/requests/user-input-requests"
import { SessionPermissions } from "./permission-card/session-permissions"
import { SessionFeed } from "./session-feed/session-feed"
import { SESSION_PAGE_IDS } from "../config/test-ids"
import type { SessionPageProps } from "./session-page.types"

export function SessionPage({
  session,
  state,
  messages,
  historyStatus = HistoryStatus.Ready,
  readingScope,
  onHistoryPage,
  tab,
  setTab,
  onBack,
  showBack = true,
  controller,
  rename,
}: SessionPageProps) {
  const { t, language } = useTranslation()
  const observed = sessionObserved(state, session)

  return (
    <section className="session:flex session:min-h-0 session:flex-1 session:flex-col" data-testid={SESSION_PAGE_IDS.root}>
      <div className="session:flex session:items-center session:gap-[8px] session:pt-[8px] session:short:pt-[4px]">
        {showBack ? (
          <Button
            variant="ghost"
            size="icon"
            className="mt-[3px] mb-[25px] session:m-0 session:size-[32px] session:flex-none session:p-0"
            data-testid={SESSION_PAGE_IDS.back}
            aria-label={t("allSessions")}
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" size={20} />
          </Button>
        ) : null}
        <div className="flex items-center justify-between gap-[14px] phone:items-start session:min-w-0 session:flex-1 session:items-center session:gap-[8px]">
          <div className="session:min-w-0">
            <h1 className={titleClass} data-testid={SESSION_PAGE_IDS.title}>
              {rename ? (
                <SessionTitle
                  key={session.id + ":" + session.generation}
                  title={sessionTitle(session, 16) ?? t("selectedChat")}
                  controller={rename}
                  disabled={state.connection !== ConnectionStatus.Online}
                />
              ) : (
                (sessionTitle(session, 16) ?? t("selectedChat"))
              )}
            </h1>
            <p className={sourceTextClass}>
              {t(sourceNames[session.target.kind])} ·{" "}
              <span className="text-[12px] text-muted-foreground session:p-0 session:text-[10px]" data-testid={SESSION_PAGE_IDS.status}>
                {t(sessionStatusLabel(session, observed))}
              </span>
            </p>
          </div>
        </div>
        <SessionAvailability key={session.id + ":availability:" + session.generation} available={observed} />
        <SessionActions
          key={session.id + ":" + session.generation}
          session={session}
          controller={controller}
          connection={state.connection}
          deviceStatus={state.snapshot?.deviceStatus ?? DeviceStatus.Offline}
        />
      </div>
      <p className="mt-[15px] text-[11px] text-muted-foreground session:mt-[5px] session:flex-none session:text-[10px] session:short:hidden">
        {t("updatedAt", { time: new Date(session.lastEventAt).toLocaleTimeString(language) })} ·{" "}
        {t(session.statusConfidence === StatusConfidence.Inferred ? "inferredStatus" : "observedStatus")}
      </p>
      {session.errorCode ? (
        <p className={noticeVariants()} role="alert" data-testid={SESSION_PAGE_IDS.sourceError}>
          {feedbackText(session.errorCode, t)}
        </p>
      ) : null}
      {session.capabilities.terminalSnapshot ? (
        <div className="mt-[28px] flex gap-[24px] border-b border-border session:mt-[4px] session:flex-none session:gap-[18px] session:short:mt-[3px]">
          <Button
            variant="ghost"
            className={cn(tabClass, tab === SessionTab.History && activeTabClass)}
            data-testid={SESSION_PAGE_IDS.history}
            onClick={() => setTab(SessionTab.History)}
          >
            {t("history")}
          </Button>
          <Button
            variant="ghost"
            className={cn(tabClass, tab === SessionTab.Terminal && activeTabClass)}
            data-testid={SESSION_PAGE_IDS.terminal}
            onClick={() => setTab(SessionTab.Terminal)}
          >
            {t("terminal")}
          </Button>
        </div>
      ) : null}
      <SubagentPanel agents={session.subagents ?? []} online={observed} />
      {session.changes ? <SessionChanges key={session.id + ":changes:" + session.generation} changes={session.changes} /> : null}
      <SessionFeed
        key={session.id + tab}
        sessionId={session.id}
        readingScope={readingScope}
        onHistoryPage={onHistoryPage}
        newestAt={session.lastMessageAt}
        agent={agentName(session)}
        messages={messages}
        historyStatus={historyStatus}
        available={observed}
        tab={tab}
        terminal={state.snapshot?.terminal ?? null}
      />
      <SessionPermissions session={session} state={state} controller={controller} />
      <UserInputRequests session={session} state={state} controller={controller} />
      <SessionActivity session={session} available={observed} />
      <SessionComposer
        controller={controller}
        session={session}
        connection={state.connection}
        deviceStatus={state.snapshot?.deviceStatus ?? DeviceStatus.Offline}
      />
    </section>
  )
}

const titleClass =
  "mt-[10px] text-[25px] phone:text-[20px] session:mt-0 session:mb-[4px] session:overflow-hidden session:text-[16px] session:tracking-[-0.3px] session:text-ellipsis session:whitespace-nowrap session:short:mb-0 session:short:text-[13px]"

const tabClass =
  "border-0 bg-transparent px-0 pt-0 pb-[12px] text-[13px] text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent session:h-[29px] session:pb-[5px] session:text-[11px] session:short:h-[25px]"

const activeTabClass = "border-b-2 border-primary text-primary hover:text-primary"
