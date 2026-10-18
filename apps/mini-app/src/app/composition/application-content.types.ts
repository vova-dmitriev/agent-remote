import type { useApplication } from "@/app/model/use-application"

export interface ApplicationContentProps {
  model: ReturnType<typeof useApplication>
  accounts: boolean
  back: () => void
  openAccounts: () => void
  closeAccounts: () => void
}
