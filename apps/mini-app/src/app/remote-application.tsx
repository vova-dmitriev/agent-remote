import { ConnectionStatus, HostKind, type Session } from "@protocol"
import { AttachmentProvider } from "@/entities/attachment"
import { useApplicationView } from "./model/navigation/use-application-view"
import { useSubagentView } from "./model/navigation/use-subagent-view"
import { ApplicationShell } from "@/widgets/application-shell"
import { CommandNotice } from "@/features/send-command"
import { StartupSkeleton } from "./startup/startup-skeleton"
import { LinkedStartup } from "./startup/linked-startup"
import { ApplicationContent } from "./composition/application-content"
import { useApplication } from "./model/use-application"
import { useDesktopLayout } from "./model/navigation/use-desktop-layout"
import { DesktopLayout } from "./composition/desktop/desktop-layout"
import { HomeView } from "./home-view"
import { useSessionRoute } from "./model/navigation/use-session-route"
import { useHost } from "@/shared/lib/host"

export function RemoteApplication() {
  const model = useApplication()
  const view = useApplicationView()
  const desktop = useDesktopLayout()
  const host = useHost()
  const { state, selected, selection, commands } = model
  const subagent = useSubagentView(selected, host.kind === HostKind.Desktop)

  const back = () => {
    view.closeAccounts()
    subagent.clear()
    selection.back(state.deviceId)
  }

  const logout = () => {
    view.closeAccounts()
    void model.logout()
  }

  const open = (session: Session) => {
    view.closeAccounts()
    model.setResult("")
    void selection.select(session)
  }

  useSessionRoute({
    enabled: host.kind === HostKind.Desktop,
    selectedId: state.selectedId,
    sessions: state.snapshot?.sessions ?? [],
    ready: state.connection === ConnectionStatus.Online && !!state.snapshot,
    open,
    close: back,
  })

  // A session link starts on the session's own skeleton, which stays until the session page replaces it.
  if (!model.preferencesReady && !model.error) return model.linkPending ? <LinkedStartup /> : <StartupSkeleton />

  if (desktop && state.connection !== ConnectionStatus.Expired) {
    return (
      <AttachmentProvider access={model.attachments}>
        <DesktopLayout model={model} view={view} subagent={subagent} back={back} logout={logout} open={open} />
      </AttachmentProvider>
    )
  }

  return (
    <AttachmentProvider access={model.attachments}>
      <ApplicationShell
        compact={(!!selected || model.linkPending) && state.connection !== ConnectionStatus.Expired}
        connection={state.connection}
        result={model.result}
        onHome={back}
        onAccounts={model.devices.length && state.connection !== ConnectionStatus.Expired ? view.openAccounts : undefined}
        onUsage={view.openUsage}
        onLogout={logout}
      >
        <CommandNotice error={model.error} busy={commands.busy} retry={() => void commands.retry()} />
        <ApplicationContent
          model={model}
          accounts={view.accounts}
          usage={view.usage}
          subagent={subagent}
          back={back}
          closeAccounts={view.closeAccounts}
          home={<HomeView model={model} />}
        />
      </ApplicationShell>
    </AttachmentProvider>
  )
}
