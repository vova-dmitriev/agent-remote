import { AgentProvider, ProfileAuthMode } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { PROFILE_CARD_IDS } from "@/pages/accounts/config/profile/test-ids"
import { profileStatusLabel } from "@/pages/accounts/lib/profile/labels"
import { ProfileDetails } from "./details/profile-details"
import { ProfileOperation } from "./operation/profile-operation"
import type { ProfileCardProps } from "./profile-card.types"

export function ProfileCard({ profile, operation, preferred, children }: ProfileCardProps) {
  const { t } = useTranslation()

  return (
    <article
      data-testid={PROFILE_CARD_IDS.root}
      data-profile-id={profile.id}
      className="grid min-w-0 gap-[6px] rounded-xl border border-border bg-card p-[12px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 data-testid={PROFILE_CARD_IDS.label} className="text-[16px] leading-[1.35] font-semibold break-words">
            {profile.label}
          </h2>
          <p className="text-sm text-muted-foreground">
            {profile.provider === AgentProvider.Codex ? "Codex" : "Claude"} ·{" "}
            {t(profile.authMode === ProfileAuthMode.ApiKey ? "accountsApiKey" : "accountsSubscription")}
            {" · "}
            <span data-testid={PROFILE_CARD_IDS.status} className="text-foreground">
              {t(profileStatusLabel[profile.status])}
            </span>
          </p>
        </div>
        {preferred ? (
          <span data-testid={PROFILE_CARD_IDS.preferred} className="text-sm text-primary">
            {t("accountsPreferred")}
          </span>
        ) : null}
      </div>
      {profile.identity ? (
        <p data-testid={PROFILE_CARD_IDS.identity} className="break-all text-sm text-muted-foreground">
          {t("accountsIdentity")}: {profile.identity.accountLabel ?? profile.identity.accountRef.slice(-12)}
        </p>
      ) : null}
      <ProfileOperation operation={operation} />
      <ProfileDetails profile={profile}>{children}</ProfileDetails>
    </article>
  )
}
