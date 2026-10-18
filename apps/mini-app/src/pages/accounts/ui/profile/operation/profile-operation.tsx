import { LoaderCircle, CircleAlert } from "lucide-react"
import { ProfileOperationPhase } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText } from "@/shared/lib/i18n"
import { PROFILE_CARD_IDS } from "@/pages/accounts/config/profile/test-ids"
import { profilePhaseLabel } from "@/pages/accounts/lib/profile/labels"
import type { ProfileOperationProps } from "./profile-operation.types"

export function ProfileOperation({ operation }: ProfileOperationProps) {
  const { t } = useTranslation()

  if (!operation) return null
  const working = operation.phase === ProfileOperationPhase.Preparing || operation.phase === ProfileOperationPhase.Removing

  return (
    <p data-testid={PROFILE_CARD_IDS.operation} role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      {working ? (
        <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      ) : (
        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      )}
      {t(profilePhaseLabel[operation.phase])}
      {operation.code ? ` · ${feedbackText(operation.code, t)}` : ""}
    </p>
  )
}
