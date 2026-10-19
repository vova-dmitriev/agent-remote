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
    <div
      className="flex min-h-[22px] flex-none items-center gap-[7px] px-[9px] py-[2px] text-[12px] leading-[18px] text-muted-foreground"
      role="status"
      aria-live="polite"
      data-testid={ACTIVITY_IDS.root}
    >
      <LoaderCircle
        className="flex-none animate-activity-spin motion-reduce:animate-none"
        size={14}
        aria-hidden="true"
        data-testid={ACTIVITY_IDS.spinner}
      />
      <span data-testid={ACTIVITY_IDS.label}>{t(label)}</span>
    </div>
  )
}
