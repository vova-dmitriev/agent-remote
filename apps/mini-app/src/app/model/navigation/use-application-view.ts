import { useState } from "react"
import { ApplicationView, DeviceView } from "./values"

const DEVICE_VIEWS: ReadonlySet<ApplicationView> = new Set(Object.values(DeviceView))

export function useApplicationView() {
  const [view, setView] = useState<ApplicationView>(ApplicationView.Sessions)
  // The session the Rules page was opened from, so its tab comes first.
  const [rulesSession, setRulesSession] = useState<string | null>(null)

  return {
    /** The settings page that belongs to the device, when one is open. */
    device: DEVICE_VIEWS.has(view) ? (view as DeviceView) : null,
    rulesSession,
    newSession: view === ApplicationView.NewSession,
    openAccounts: () => setView(ApplicationView.Accounts),
    openUsage: () => setView(ApplicationView.Usage),
    openRules: (sessionId: string | null = null) => {
      setRulesSession(sessionId)
      setView(ApplicationView.Rules)
    },
    openNewSession: () => setView(ApplicationView.NewSession),
    closeAccounts: () => setView(ApplicationView.Sessions),
  }
}
