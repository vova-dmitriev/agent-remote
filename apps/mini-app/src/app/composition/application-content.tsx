import { ConnectionStatus, DeviceStatus, HistoryStatus } from "@protocol"
import { AccountsPage } from "@/pages/accounts"
import { SignInPage } from "@/pages/sign-in"
import { SessionPage, SubagentPage } from "@/pages/session"
import { HomeView } from "@/app/home-view"
import type { ApplicationContentProps } from "./application-content.types"

export function ApplicationContent({ model, accounts, subagent, back, openAccounts, closeAccounts }: ApplicationContentProps) {
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
  if (subagent.agentId) return <SubagentPage session={selected} state={state} agentId={subagent.agentId} onBack={subagent.close} />

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
      onOpenSubagent={subagent.supported ? (agentId) => subagent.open(selected.id, agentId) : undefined}
    />
  )
}
