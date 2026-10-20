import { UserRound } from "lucide-react"
import type { ExecutionProfileSummary } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { ChoiceDropdown } from "@/shared/ui/dropdown"
import { chipFieldClass, chipLabelClass } from "../config/chip-classes"
import { SESSION_CREATE_IDS } from "../config/test-ids"
import { profileOptions } from "../model/launch-options"

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
  const nativeLabel = t("sessionLaunchNative", { provider: nativeProvider })

  return (
    <ChoiceDropdown
      value={profileId}
      onChange={onChange}
      label={t("sessionLaunchProfile")}
      triggerLabel={profileId === "" ? nativeLabel : (profile?.label ?? profileId)}
      icon={UserRound}
      ids={SESSION_CREATE_IDS.profile}
      className={chipFieldClass}
      labelClassName={chipLabelClass}
      disabled={disabled}
      options={profileOptions(profiles, profileId, profile, nativeLabel, t)}
    />
  )
}
