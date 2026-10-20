import type { Session } from "@protocol"
import type { useApplication } from "@/app/model/use-application"
import type { useApplicationView } from "@/app/model/navigation/use-application-view"
import type { useSubagentView } from "@/app/model/navigation/use-subagent-view"

export interface DesktopLayoutProps {
  model: ReturnType<typeof useApplication>
  view: ReturnType<typeof useApplicationView>
  subagent: ReturnType<typeof useSubagentView>
  back: () => void
  logout: () => void
  open: (session: Session) => void
}

export interface DesktopSidebarProps {
  accounts: boolean
  collapsed: boolean
  onOpen: (session: Session) => void
  onExpand: () => void
  onNewSession: () => void
  width: number
  onResize: (width: number, done: boolean) => void
  onResetWidth: () => void
}

export interface DesktopPaneProps {
  model: ReturnType<typeof useApplication>
}
