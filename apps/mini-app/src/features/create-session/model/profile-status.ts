import { ProfileAuthMode, type ExecutionProfileSummary } from "@protocol"
import type { Translate } from "@/shared/lib/i18n"

export interface SessionProfileStatusModel {
  profileId: string
  profile: ExecutionProfileSummary | undefined
  profileAvailable: boolean
  modelId: string
}

export interface SessionProfileStatusState {
  online: boolean
  unavailable: boolean
  checking: boolean
}

export function resolveSessionProfileStatus(
  model: SessionProfileStatusModel,
  state: SessionProfileStatusState,
  translate: Translate,
): string {
  if (model.profileId !== "") {
    if (!model.profileAvailable || !model.profile) {
      return translate("sessionSelectedProfileUnavailable", {
        label: model.profile?.label ?? model.profileId,
      })
    }

    const billing =
      model.profile.authMode === ProfileAuthMode.ApiKey
        ? translate("sessionProfileBillingApiKey")
        : translate("sessionProfileBillingSubscription")

    const profileHint = translate("sessionSelectedProfileHint", {
      label: model.profile.label,
      billing,
    })

    return model.modelId === "" ? `${profileHint} ${translate("sessionChooseProfileModelHint")}` : profileHint
  }

  if (state.checking) return translate("sessionProfilesChecking")
  if (state.unavailable || !state.online) return translate("sessionProfilesUnavailable")

  return translate("sessionLegacyLaunchHint")
}
