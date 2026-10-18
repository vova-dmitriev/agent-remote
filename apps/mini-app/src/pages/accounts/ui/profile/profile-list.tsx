import { AgentProvider, ProfileAuthMode, ProfileStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { ProfileActions } from "../management/profile-actions"
import { ProfileEnrollment } from "../enrollment/profile-enrollment"
import { ProfileCard } from "./profile-card"
import type { ProfileListProps } from "./profile-list.types"

export function ProfileList({ data, disabled, run, perform }: ProfileListProps) {
  const { t } = useTranslation()

  return data.profiles.map((profile) => {
    const operation = data.operations.find((entry) => entry.profileId === profile.id)
    const preferred = data.defaults[profile.provider] === profile.id

    return (
      <ProfileCard key={profile.id} profile={profile} operation={operation} preferred={preferred}>
        <ProfileActions profile={profile} operation={operation} preferred={preferred} disabled={disabled} run={run} />
        {profile.provider === AgentProvider.Codex && profile.authMode === ProfileAuthMode.ApiKey ? (
          <ProfileEnrollment
            profile={profile}
            disabled={disabled || profile.status === ProfileStatus.Disabled || profile.status === ProfileStatus.Removing}
            perform={perform}
          />
        ) : null}
        {profile.provider === AgentProvider.Claude ? (
          <p className="text-sm text-muted-foreground">{t("accountsClaudeUnsupported")}</p>
        ) : null}
      </ProfileCard>
    )
  })
}
