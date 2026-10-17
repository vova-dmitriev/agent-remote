import { ConnectionStatus, DeviceStatus, CommandActionType } from "@protocol"
import { SessionsPage, SessionCreation } from "@/pages/sessions"
import { PairDevice } from "@/features/pair-device"
import { DeviceAccess } from "@/features/device-access"
import type { HomeViewProps } from "./model/types/home-view.types"

export function HomeView({ model }: HomeViewProps) {
  return (
    <SessionsPage
      sessions={model.state.snapshot?.sessions ?? []}
      creation={
        <SessionCreation
          sessions={model.state.snapshot?.sessions ?? []}
          disabled={
            model.state.connection !== ConnectionStatus.Online ||
            model.state.snapshot?.deviceStatus !== DeviceStatus.Online ||
            model.commands.busy ||
            model.commands.awaitingReceipt ||
            model.commands.uncertain
          }
          create={(session, provider) =>
            void model.commands.action({ type: CommandActionType.CreateSession, provider, cwd: session.cwd! }, session)
          }
        />
      }
      connected={!!model.devices.length}
      loading={model.loading}
      onSelect={(session) => {
        model.setResult("")
        void model.selection.select(session)
      }}
    >
      {model.devices.length ? (
        <DeviceAccess devices={model.devices} connectors={model.state.connectors} revoke={(id) => void model.revoke(id)} />
      ) : (
        <PairDevice controller={model.pairing} online={model.state.connection === ConnectionStatus.Online} />
      )}
    </SessionsPage>
  )
}
