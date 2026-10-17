import { useState, type ComponentProps } from "react"
import { SessionsPage } from "@/pages/sessions"
import { DeviceAccess } from "@/features/device-access"
import { PairDevice } from "@/features/pair-device"
import { allSources, connectors } from "../fixtures/page-states"

type PageProps = ComponentProps<typeof SessionsPage>

export function SessionsPageStory({
  sessions = allSources,
  connected = true,
  loading = false,
  pairingBusy = false,
  online = true,
}: Partial<Pick<PageProps, "sessions" | "connected" | "loading">> & { pairingBusy?: boolean; online?: boolean }) {
  const [code, setCode] = useState("")

  return (
    <SessionsPage sessions={sessions} connected={connected} loading={loading} onSelect={() => {}}>
      {connected ? (
        <DeviceAccess devices={[{ id: "fixture-mac", last_seen_at: "1700000000000" }]} connectors={connectors} revoke={() => {}} />
      ) : (
        <PairDevice
          online={online}
          controller={{ code, setCode, busy: pairingBusy, submit: async (event) => event.preventDefault(), reset: () => setCode("") }}
        />
      )}
    </SessionsPage>
  )
}
