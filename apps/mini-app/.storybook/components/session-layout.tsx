import type { ReactNode } from "react"
import { ConnectionStatus } from "@protocol"
import { ApplicationShell } from "@/widgets/application-shell"

/** The real compact session shell the app renders around a selected session, so stories show the actual layout. */
export function SessionLayout({ children }: { children: ReactNode }) {
  return (
    <ApplicationShell compact connection={ConnectionStatus.Online} result="" onHome={() => {}} onLogout={() => {}}>
      {children}
    </ApplicationShell>
  )
}
