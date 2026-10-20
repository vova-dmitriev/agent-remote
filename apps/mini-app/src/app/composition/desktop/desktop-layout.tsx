import { ApplicationShell, DesktopHeader } from "@/widgets/application-shell"
import { useSidebarCollapsed, useSidebarWidth } from "@/widgets/session-sidebar"
import { CommandNotice } from "@/features/send-command"
import { useStableCallback } from "@/shared/lib/hooks"
import { DESKTOP_IDS } from "@/app/config/test-ids"
import { ApplicationContent } from "../application-content"
import { DesktopNewSession } from "./desktop-new-session"
import { DesktopPlaceholder } from "./desktop-placeholder"
import { DesktopSidebar } from "./desktop-sidebar"
import type { DesktopLayoutProps } from "./desktop-layout.types"

/** Desktop host at ≥ 960 px: app bar, session sidebar and the selected session (or a placeholder) in the main pane. */
export function DesktopLayout({ model, view, subagent, back, logout, open }: DesktopLayoutProps) {
  const { state, selected, commands } = model
  const sidebar = useSidebarCollapsed()
  const onAccounts = model.devices.length ? view.openAccounts : undefined
  const onOpen = useStableCallback(open)
  const onExpand = useStableCallback(() => sidebar.setCollapsed(false))
  const sidebarWidth = useSidebarWidth()
  const onResize = useStableCallback(sidebarWidth.resize)
  const onResetWidth = useStableCallback(sidebarWidth.reset)

  const onNewSession = useStableCallback(() => {
    back()
    view.openNewSession()
  })

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
        <DesktopSidebar
          accounts={view.accounts}
          collapsed={sidebar.collapsed}
          onOpen={onOpen}
          onExpand={onExpand}
          onNewSession={onNewSession}
          width={sidebarWidth.width}
          onResize={onResize}
          onResetWidth={onResetWidth}
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
              subagent={subagent}
              back={back}
              closeAccounts={view.closeAccounts}
              sessionBack={false}
              home={view.newSession ? <DesktopNewSession model={model} /> : <DesktopPlaceholder />}
            />
          </ApplicationShell>
        </div>
      </div>
    </div>
  )
}
