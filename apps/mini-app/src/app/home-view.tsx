import { ConnectionStatus } from "@protocol"
import { SessionsPage } from "@/pages/sessions"
import { SessionCreation } from "@/features/create-session"
import { PairDevice } from "@/features/pair-device"
import { DeviceAccess } from "@/features/device-access"
import type { HomeViewProps } from "./model/types/home-view.types"
import { sessionCreationProps } from "./model/session-creation-props"
import { useHost } from "@/shared/lib/host"
import { useSessionPageLoader } from "./model/session-pages/use-session-page-loader"

export function HomeView({ model }: HomeViewProps) {
  const host = useHost()
  const pageLoader = useSessionPageLoader(model.state.deviceId, model.state.snapshot?.cursor.streamId ?? null)

  return (
    <SessionsPage
      sessions={model.state.snapshot?.sessions ?? []}
      pageScope={pageLoader.scope}
      onLoadPage={pageLoader.loadPage}
      creation={<SessionCreation {...sessionCreationProps(model)} />}
      connected={!!model.devices.length}
      loading={model.loading}
      onSelect={(session) => {
        model.setResult("")
        void model.selection.select(session)
      }}
    >
      {model.devices.length && host.capabilities.revokeDevice ? (
        <DeviceAccess devices={model.devices} connectors={model.state.connectors} revoke={(id) => void model.revoke(id)} />
      ) : host.capabilities.pairDevice ? (
        <PairDevice controller={model.pairing} online={model.state.connection === ConnectionStatus.Online} />
      ) : null}
    </SessionsPage>
  )
}
