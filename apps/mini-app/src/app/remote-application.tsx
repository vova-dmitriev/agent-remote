import { ConnectionStatus } from "@protocol"
import { AttachmentProvider } from "@/entities/attachment"
import { useApplicationView } from "./model/navigation/use-application-view"
import { ApplicationShell } from "@/widgets/application-shell"
import { CommandNotice } from "@/features/send-command"
import { StartupSkeleton } from "./startup-skeleton"
import { ApplicationContent } from "./composition/application-content"
import { useApplication } from "./model/use-application"

export function RemoteApplication() {
  const model = useApplication()
  const view = useApplicationView()
  const { state, selected, selection, commands } = model

  const back = () => {
    view.closeAccounts()
    selection.back(state.deviceId)
  }

  if (!model.preferencesReady && !model.error) return <StartupSkeleton />

  return (
    <AttachmentProvider access={model.attachments}>
      <ApplicationShell
        compact={!!selected && state.connection !== ConnectionStatus.Expired}
        connection={state.connection}
        result={model.result}
        onHome={back}
        onAccounts={model.devices.length && state.connection !== ConnectionStatus.Expired ? view.openAccounts : undefined}
        onLogout={() => {
          view.closeAccounts()
          void model.logout()
        }}
      >
        <CommandNotice error={model.error} busy={commands.busy} retry={() => void commands.retry()} />
        <ApplicationContent model={model} accounts={view.accounts} back={back} closeAccounts={view.closeAccounts} />
      </ApplicationShell>
    </AttachmentProvider>
  )
}
