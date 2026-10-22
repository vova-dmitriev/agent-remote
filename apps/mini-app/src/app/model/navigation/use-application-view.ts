import { useState } from "react"
import { ApplicationView, DeviceView } from "./values"

const DEVICE_VIEWS: ReadonlySet<ApplicationView> = new Set(Object.values(DeviceView))

export function useApplicationView() {
  const [view, setView] = useState<ApplicationView>(ApplicationView.Sessions)
  // The session the Rules or Usage page was opened from: its rules tab comes first, its usage is picked.
  const [fromSession, setFromSession] = useState<string | null>(null)

  return {
    /** The settings page that belongs to the device, when one is open. */
    device: DEVICE_VIEWS.has(view) ? (view as DeviceView) : null,
    fromSession,
    newSession: view === ApplicationView.NewSession,
    openAccounts: () => setView(ApplicationView.Accounts),
    openUsage: (sessionId: string | null = null) => {
      setFromSession(sessionId)
      setView(ApplicationView.Usage)
    },
    openRules: (sessionId: string | null = null) => {
      setFromSession(sessionId)
      setView(ApplicationView.Rules)
    },
    openNewSession: () => setView(ApplicationView.NewSession),
    closeAccounts: () => setView(ApplicationView.Sessions),
  }
}
