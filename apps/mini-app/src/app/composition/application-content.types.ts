import type { useApplication } from "@/app/model/use-application"
import type { useSubagentView } from "@/app/model/navigation/use-subagent-view"

export interface ApplicationContentProps {
  model: ReturnType<typeof useApplication>
  accounts: boolean
  subagent: ReturnType<typeof useSubagentView>
  back: () => void
  openAccounts: () => void
  closeAccounts: () => void
}
