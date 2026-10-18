import { ProfileAuthMode, type ExecutionProfileSummary } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_CREATE_IDS } from "../config/test-ids"

interface ProfileSelectFieldProps {
  nativeProvider: string
  profiles: ExecutionProfileSummary[]
  profileId: string
  profile: ExecutionProfileSummary | undefined
  disabled: boolean
  onChange: (value: string) => void
}

export function ProfileSelectField({ nativeProvider, profiles, profileId, profile, disabled, onChange }: ProfileSelectFieldProps) {
  const { t } = useTranslation()

  return (
    <label className="block text-sm">
      {t("sessionLaunchProfile")}
      <select
        className="mt-1 w-full rounded-md border border-border bg-background p-2"
        data-testid={SESSION_CREATE_IDS.profile}
        value={profileId}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">{t("sessionLaunchNative", { provider: nativeProvider })}</option>
        {profiles.map((entry) => (
          <option key={entry.id} value={entry.id} data-testid={SESSION_CREATE_IDS.profileOption}>
            {entry.label} · {entry.identity?.accountLabel ?? entry.identity?.accountRef.slice(-12)} ·{" "}
            {t(entry.authMode === ProfileAuthMode.ApiKey ? "accountsApiKey" : "accountsSubscription")}
          </option>
        ))}
        {profileId !== "" && !profiles.some((entry) => entry.id === profileId) ? (
          <option value={profileId} disabled>
            {t("sessionSelectedProfileUnavailable", { label: profile?.label ?? profileId })}
          </option>
        ) : null}
      </select>
    </label>
  )
}
