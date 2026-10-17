import { LoaderCircle } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { ACTIVITY_IDS } from "@/pages/session/config/test-ids"
import { useActivity } from "@/pages/session/model/activity/use-activity"
import type { SessionActivityProps } from "./session-activity.types"

export function SessionActivity({ session, available }: SessionActivityProps) {
  const { t } = useTranslation()
  const label = useActivity(session, available)

  if (!label) return null

  return (
    <div className="session-activity" role="status" aria-live="polite" data-testid={ACTIVITY_IDS.root}>
      <LoaderCircle className="session-activity-spinner" size={14} aria-hidden="true" data-testid={ACTIVITY_IDS.spinner} />
      <span data-testid={ACTIVITY_IDS.label}>{t(label)}</span>
    </div>
  )
}
