import { KeyRound } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { useTranslation } from "@/shared/lib/hooks"
import { ACCOUNTS_PAGE_IDS } from "@/pages/accounts"
import { ConnectionStatus, DeviceStatus, CommandActionType } from "@protocol"
import { SessionsPage } from "@/pages/sessions"
import { SessionCreation } from "@/features/create-session"
import { PairDevice } from "@/features/pair-device"
import { DeviceAccess } from "@/features/device-access"
import type { HomeViewProps } from "./model/types/home-view.types"
import { useHost } from "@/shared/lib/host"

export function HomeView({ model, openAccounts }: HomeViewProps) {
  const host = useHost()
  const { t } = useTranslation()

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
          online={model.state.connection === ConnectionStatus.Online && model.state.snapshot?.deviceStatus === DeviceStatus.Online}
          create={(session, provider, execution) =>
            void model.commands.action(
              { type: CommandActionType.CreateSession, provider, cwd: session.cwd!, ...(execution ? { execution } : {}) },
              session,
            )
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
        <Button data-testid={ACCOUNTS_PAGE_IDS.open} variant="outline" onClick={openAccounts} className="mb-4">
          <KeyRound />
          {t("accountsTitle")}
        </Button>
      ) : null}
      {model.devices.length && host.capabilities.revokeDevice ? (
        <DeviceAccess devices={model.devices} connectors={model.state.connectors} revoke={(id) => void model.revoke(id)} />
      ) : host.capabilities.pairDevice ? (
        <PairDevice controller={model.pairing} online={model.state.connection === ConnectionStatus.Online} />
      ) : null}
    </SessionsPage>
  )
}
