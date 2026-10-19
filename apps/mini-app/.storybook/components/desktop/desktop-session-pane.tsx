import { useState } from "react"
import { ConnectionStatus, type Session } from "@protocol"
import { SessionTab } from "@/entities/session"
import { SessionPage } from "@/pages/session"
import { ApplicationShell } from "@/widgets/application-shell"
import { useCommandFixture } from "../../model/use-command-fixture"
import { messages, snapshot } from "../../fixtures/session"
import { sessionState } from "../../fixtures/page-states"

interface DesktopSessionPaneProps {
  session: Session
  sessions: Session[]
  onBack: () => void
}

/** Reuses the existing compact session page; the viewport variable keeps it inside the pane below the app bar. */
export function DesktopSessionPane({ session, sessions, onBack }: DesktopSessionPaneProps) {
  const controller = useCommandFixture()
  const [tab, setTab] = useState<SessionTab>(SessionTab.History)
  const state = sessionState({ selectedId: session.id, snapshot: { ...snapshot, sessions, permissions: [] } })

  return (
    <div className="h-full [--tg-viewport-height:calc(100dvh-3rem)]">
      <ApplicationShell compact connection={ConnectionStatus.Online} result="" onHome={onBack} onLogout={() => {}}>
        <SessionPage
          session={session}
          state={state}
          messages={messages}
          tab={tab}
          setTab={setTab}
          onBack={onBack}
          controller={controller}
        />
      </ApplicationShell>
    </div>
  )
}
