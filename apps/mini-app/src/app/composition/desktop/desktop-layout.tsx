import { ConnectionStatus, DeviceStatus, type Session } from "@protocol"
import { ApplicationShell, DesktopHeader } from "@/widgets/application-shell"
import { SessionSidebar, useSidebarCollapsed } from "@/widgets/session-sidebar"
import { CommandNotice } from "@/features/send-command"
import { DESKTOP_IDS } from "@/app/config/test-ids"
import { ApplicationContent } from "../application-content"
import { DesktopNewSession } from "./desktop-new-session"
import { DesktopPlaceholder } from "./desktop-placeholder"
import type { DesktopLayoutProps } from "./desktop-layout.types"

/** Desktop host at ≥ 960 px: app bar, session sidebar and the selected session (or a placeholder) in the main pane. */
export function DesktopLayout({ model, view, back, logout }: DesktopLayoutProps) {
  const { state, selected, selection, commands } = model
  const sidebar = useSidebarCollapsed()
  const sessions = state.snapshot?.sessions ?? []
  const online = state.connection === ConnectionStatus.Online
  const onAccounts = model.devices.length ? view.openAccounts : undefined

  const open = (session: Session) => {
    view.closeAccounts()
    model.setResult("")
    void selection.select(session)
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground" data-testid={DESKTOP_IDS.root}>
      <DesktopHeader
        connection={state.connection}
        sidebarCollapsed={sidebar.collapsed}
        onToggleSidebar={sidebar.toggle}
        onHome={back}
        onAccounts={onAccounts}
        onLogout={logout}
      />
      <div className="flex min-h-0 flex-1">
        <SessionSidebar
          sessions={sessions}
          activeId={view.accounts ? null : (selected?.id ?? null)}
          collapsed={sidebar.collapsed}
          deviceOnline={online && state.snapshot?.deviceStatus === DeviceStatus.Online}
          onOpen={open}
          onExpand={() => sidebar.setCollapsed(false)}
          onNewSession={() => {
            back()
            view.openNewSession()
          }}
        />
        <div className="min-w-0 flex-1 overflow-y-auto [--tg-viewport-height:calc(100dvh-3rem)]">
          <ApplicationShell
            compact={!!selected && !view.accounts}
            chrome={false}
            connection={state.connection}
            result={model.result}
            onHome={back}
            onLogout={logout}
          >
            <CommandNotice error={model.error} busy={commands.busy} retry={() => void commands.retry()} />
            <ApplicationContent
              model={model}
              accounts={view.accounts}
              back={back}
              closeAccounts={view.closeAccounts}
              home={view.newSession ? <DesktopNewSession model={model} /> : <DesktopPlaceholder />}
            />
          </ApplicationShell>
        </div>
      </div>
    </div>
  )
}
