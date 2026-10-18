import { ConnectionStatus, DeviceStatus, HistoryStatus } from "@protocol"
import { AccountsPage } from "@/pages/accounts"
import { SignInPage } from "@/pages/sign-in"
import { SessionPage } from "@/pages/session"
import { HomeView } from "@/app/home-view"
import type { ApplicationContentProps } from "./application-content.types"

export function ApplicationContent({ model, accounts, back, openAccounts, closeAccounts }: ApplicationContentProps) {
  const { state, selected, selection, commands } = model

  if (state.connection === ConnectionStatus.Expired) return <SignInPage />
  if (accounts && state.deviceId)
    return (
      <AccountsPage
        deviceId={state.deviceId}
        online={state.connection === ConnectionStatus.Online && state.snapshot?.deviceStatus === DeviceStatus.Online}
        onBack={closeAccounts}
      />
    )
  if (!selected) return <HomeView model={model} openAccounts={openAccounts} />

  return (
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
  )
}
