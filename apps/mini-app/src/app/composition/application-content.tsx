import { ConnectionStatus, HistoryStatus } from "@protocol"
import { DevicePage } from "./device-page"
import { SignInPage } from "@/pages/sign-in"
import { useState } from "react"
import { SessionFilePage, SessionLoading, SessionPage, SubagentPage } from "@/pages/session"
import type { ApplicationContentProps } from "./application-content.types"

export function ApplicationContent({
  model,
  device,
  rulesSession,
  openRules,
  subagent,
  back,
  closeAccounts,
  home,
  sessionBack = true,
}: ApplicationContentProps) {
  const { state, selected, selection, commands } = model
  // The open file belongs to one session; switching sessions closes it.
  const [file, setFile] = useState<{ sessionId: string; path: string } | null>(null)

  if (state.connection === ConnectionStatus.Expired) return <SignInPage />
  if (device && state.deviceId)
    return <DevicePage page={device} deviceId={state.deviceId} state={state} rulesSession={rulesSession} onBack={closeAccounts} />
  if (!selected) return model.linkPending ? <SessionLoading /> : home
  if (subagent.agentId)
    return (
      <SubagentPage
        key={[selected.id, subagent.agentId, selected.generation].join(":")}
        session={selected}
        state={state}
        agentId={subagent.agentId}
        onBack={subagent.close}
      />
    )

  if (file?.sessionId === selected.id)
    return <SessionFilePage key={selected.id + ":" + file.path} session={selected} path={file.path} onBack={() => setFile(null)} />

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
      showBack={sessionBack}
      rename={model.rename}
      controller={commands}
      onOpenSubagent={subagent.readable ? (agentId) => subagent.open(selected.id, agentId) : undefined}
      onOpenFile={(path) => setFile({ sessionId: selected.id, path })}
      onOpenRules={openRules}
    />
  )
}
