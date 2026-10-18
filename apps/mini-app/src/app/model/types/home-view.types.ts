import type { useApplication } from "../use-application"

export interface HomeViewProps {
  openAccounts: () => void
  model: ReturnType<typeof useApplication>
}
