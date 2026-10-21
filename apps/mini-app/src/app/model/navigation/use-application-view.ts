import { useState } from "react"
import { ApplicationView } from "./values"

export function useApplicationView() {
  const [view, setView] = useState<ApplicationView>(ApplicationView.Sessions)

  return {
    accounts: view === ApplicationView.Accounts,
    usage: view === ApplicationView.Usage,
    newSession: view === ApplicationView.NewSession,
    openAccounts: () => setView(ApplicationView.Accounts),
    openUsage: () => setView(ApplicationView.Usage),
    openNewSession: () => setView(ApplicationView.NewSession),
    closeAccounts: () => setView(ApplicationView.Sessions),
  }
}
