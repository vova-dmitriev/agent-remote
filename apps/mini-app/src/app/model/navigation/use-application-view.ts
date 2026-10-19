import { useState } from "react"
import { ApplicationView } from "./values"

export function useApplicationView() {
  const [view, setView] = useState<ApplicationView>(ApplicationView.Sessions)

  return {
    accounts: view === ApplicationView.Accounts,
    newSession: view === ApplicationView.NewSession,
    openAccounts: () => setView(ApplicationView.Accounts),
    openNewSession: () => setView(ApplicationView.NewSession),
    closeAccounts: () => setView(ApplicationView.Sessions),
  }
}
