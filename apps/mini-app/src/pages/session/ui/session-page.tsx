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
} from "@/entities/session"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { SessionTitle } from "@/features/rename-session"
import { SessionComposer, SessionActions } from "@/features/send-command"
import { Button } from "@/shared/ui/button"
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
  controller,
  rename,
}: SessionPageProps) {
  const { t, language } = useTranslation()
  const observed = sessionObserved(state, session)

  return (
    <section className="detail" data-testid={SESSION_PAGE_IDS.root}>
      <div className="detail-toolbar">
        <Button
          variant="ghost"
          size="icon"
          className="back"
          data-testid={SESSION_PAGE_IDS.back}
          aria-label={t("allSessions")}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={20} />
        </Button>
        <div className="detail-heading">
          <div>
            <h1 data-testid={SESSION_PAGE_IDS.title}>
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
            <p className="source">
              {t(sourceNames[session.target.kind])} ·{" "}
              <span className="status" data-testid={SESSION_PAGE_IDS.status}>
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
      <p className="freshness">
        {t("updatedAt", { time: new Date(session.lastEventAt).toLocaleTimeString(language) })} ·{" "}
        {t(session.statusConfidence === StatusConfidence.Inferred ? "inferredStatus" : "observedStatus")}
      </p>
      {session.errorCode ? (
        <p className="notice" role="alert" data-testid={SESSION_PAGE_IDS.sourceError}>
          {feedbackText(session.errorCode, t)}
        </p>
      ) : null}
      {session.capabilities.terminalSnapshot ? (
        <div className="tabs">
          <Button
            variant="ghost"
            className={tab === SessionTab.History ? "active" : ""}
            data-testid={SESSION_PAGE_IDS.history}
            onClick={() => setTab(SessionTab.History)}
          >
            {t("history")}
          </Button>
          <Button
            variant="ghost"
            className={tab === SessionTab.Terminal ? "active" : ""}
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
