import { useState } from "react"
import { ApplicationView } from "./values"

export function useApplicationView() {
  const [view, setView] = useState<ApplicationView>(ApplicationView.Sessions)

  return {
    accounts: view === ApplicationView.Accounts,
    openAccounts: () => setView(ApplicationView.Accounts),
    closeAccounts: () => setView(ApplicationView.Sessions),
  }
}
