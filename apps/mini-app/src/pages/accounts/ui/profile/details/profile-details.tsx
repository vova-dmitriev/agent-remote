import { ProfileStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { PROFILE_CARD_IDS } from "@/pages/accounts/config/profile/test-ids"
import type { ProfileDetailsProps } from "./profile-details.types"

export function ProfileDetails({ profile, children }: ProfileDetailsProps) {
  const { t } = useTranslation()

  if (!children) return null

  return (
    <details data-testid={PROFILE_CARD_IDS.details} className="border-t border-border pt-2">
      <summary data-testid={PROFILE_CARD_IDS.manage} className="cursor-pointer text-sm text-primary">
        {t("accountsManage")}
      </summary>
      <div className="grid gap-3 pt-3">
        {profile.identity?.workspaceRef ? <p className="break-all text-sm text-muted-foreground">{profile.identity.workspaceRef}</p> : null}
        {profile.status === ProfileStatus.Ready ? <p className="text-sm text-muted-foreground">{t("accountsQuotaUnknown")}</p> : null}
        {children}
      </div>
    </details>
  )
}
