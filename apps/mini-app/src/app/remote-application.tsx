import { ConnectionStatus, HistoryStatus } from "@protocol"
import { AttachmentProvider } from "@/entities/attachment"
import { SignInPage } from "@/pages/sign-in"
import { SessionPage } from "@/pages/session"
import { ApplicationShell } from "@/widgets/application-shell"
import { CommandNotice } from "@/features/send-command"
import { StartupSkeleton } from "./startup-skeleton"
import { HomeView } from "./home-view"
import { useApplication } from "./model/use-application"

export function RemoteApplication() {
  const model = useApplication()
  const { state, selected, selection, commands } = model
  const back = () => selection.back(state.deviceId)

  if (!model.preferencesReady && !model.error) return <StartupSkeleton />

  return (
    <AttachmentProvider access={model.attachments}>
      <ApplicationShell
        compact={!!selected && state.connection !== ConnectionStatus.Expired}
        connection={state.connection}
        result={model.result}
        onHome={back}
        onLogout={() => void model.logout()}
      >
        <CommandNotice error={model.error} busy={commands.busy} retry={() => void commands.retry()} />
        {state.connection === ConnectionStatus.Expired ? (
          <SignInPage />
        ) : selected ? (
          <SessionPage
            session={selected}
            readingScope={state.deviceId ? state.deviceId + ":" + selected.id : undefined}
            state={state}
            messages={state.messages[selected.id] ?? []}
            historyStatus={state.history?.sessionId === selected.id ? state.history.status : HistoryStatus.Loading}
            onHistoryPage={(direction) => selection.loadPage(direction)}
            tab={selection.tab}
            setTab={selection.setTab}
            onBack={back}
            rename={model.rename}
            controller={commands}
          />
        ) : (
          <HomeView model={model} />
        )}
      </ApplicationShell>
    </AttachmentProvider>
  )
}
