import { ConnectionStatus } from "@protocol"
import { AttachmentProvider } from "@/entities/attachment"
import { useApplicationView } from "./model/navigation/use-application-view"
import { ApplicationShell } from "@/widgets/application-shell"
import { CommandNotice } from "@/features/send-command"
import { StartupSkeleton } from "./startup-skeleton"
import { ApplicationContent } from "./composition/application-content"
import { useApplication } from "./model/use-application"
import { useDesktopLayout } from "./model/navigation/use-desktop-layout"
import { DesktopLayout } from "./composition/desktop/desktop-layout"
import { HomeView } from "./home-view"

export function RemoteApplication() {
  const model = useApplication()
  const view = useApplicationView()
  const desktop = useDesktopLayout()
  const { state, selected, selection, commands } = model

  const back = () => {
    view.closeAccounts()
    selection.back(state.deviceId)
  }

  const logout = () => {
    view.closeAccounts()
    void model.logout()
  }

  if (!model.preferencesReady && !model.error) return <StartupSkeleton />

  if (desktop && state.connection !== ConnectionStatus.Expired) {
    return (
      <AttachmentProvider access={model.attachments}>
        <DesktopLayout model={model} view={view} back={back} logout={logout} />
      </AttachmentProvider>
    )
  }

  return (
    <AttachmentProvider access={model.attachments}>
      <ApplicationShell
        compact={!!selected && state.connection !== ConnectionStatus.Expired}
        connection={state.connection}
        result={model.result}
        onHome={back}
        onAccounts={model.devices.length && state.connection !== ConnectionStatus.Expired ? view.openAccounts : undefined}
        onLogout={logout}
      >
        <CommandNotice error={model.error} busy={commands.busy} retry={() => void commands.retry()} />
        <ApplicationContent
          model={model}
          accounts={view.accounts}
          back={back}
          closeAccounts={view.closeAccounts}
          home={<HomeView model={model} />}
        />
      </ApplicationShell>
    </AttachmentProvider>
  )
}
