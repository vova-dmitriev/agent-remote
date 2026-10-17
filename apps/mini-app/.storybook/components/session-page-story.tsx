import { useState, type ComponentProps } from "react"
import { HistoryStatus } from "@protocol"
import { SessionTab } from "@/entities/session"
import { SessionPage } from "@/pages/session"
import { useCommandFixture } from "../model/use-command-fixture"
import { terminalSession, messages as history } from "../fixtures/session"
import { sessionState } from "../fixtures/page-states"

type PageProps = ComponentProps<typeof SessionPage>

export function SessionPageStory({
  session = terminalSession,
  state = sessionState(),
  messages = history,
  historyStatus = HistoryStatus.Ready,
  tab: initialTab = SessionTab.History,
  busy = false,
}: Partial<Pick<PageProps, "session" | "state" | "messages" | "tab" | "historyStatus">> & { busy?: boolean }) {
  const controller = useCommandFixture()
  const [tab, setTab] = useState(initialTab)

  return (
    <SessionPage
      session={session}
      state={state}
      messages={messages}
      historyStatus={historyStatus}
      tab={tab}
      setTab={setTab}
      onBack={() => {}}
      controller={{ ...controller, busy }}
    />
  )
}
