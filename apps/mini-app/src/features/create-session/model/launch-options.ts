import { ProfileAuthMode, type ExecutionProfileSummary, type ReasoningEffort } from "@protocol"
import type { Translate } from "@/shared/lib/i18n"
import { SESSION_CREATE_IDS } from "../config/test-ids"

/** One entry of a launch chip dropdown; a previously chosen value that is no longer offered stays visible but disabled. */
interface LaunchOption<Value extends string> {
  value: Value
  label: string
  testId: string
  disabled?: boolean
}

type ProfileModel = ExecutionProfileSummary["models"][number]

function unavailable<Value extends string>(value: Value, label: string, testId: string): LaunchOption<Value>[] {
  return [{ value, label, testId, disabled: true }]
}

export function profileOptions(
  profiles: ExecutionProfileSummary[],
  profileId: string,
  profile: ExecutionProfileSummary | undefined,
  nativeLabel: string,
  translate: Translate,
): LaunchOption<string>[] {
  const testId = SESSION_CREATE_IDS.profileOption
  const listed = profiles.some((entry) => entry.id === profileId)

  const entries = profiles.map((entry) => ({
    value: entry.id,
    label: [
      entry.label,
      entry.identity?.accountLabel ?? entry.identity?.accountRef.slice(-12),
      translate(entry.authMode === ProfileAuthMode.ApiKey ? "accountsApiKey" : "accountsSubscription"),
    ].join(" · "),
    testId,
  }))

  const missing =
    profileId !== "" && !listed
      ? unavailable(profileId, translate("sessionSelectedProfileUnavailable", { label: profile?.label ?? profileId }), testId)
      : []

  return [{ value: "", label: nativeLabel, testId }, ...entries, ...missing]
}

export function modelOptions(models: ProfileModel[], modelId: string, emptyLabel: string, translate: Translate): LaunchOption<string>[] {
  const testId = SESSION_CREATE_IDS.modelOption
  const listed = models.some((entry) => entry.id === modelId)

  const missing =
    modelId !== "" && !listed ? unavailable(modelId, translate("sessionSelectedModelUnavailable", { model: modelId }), testId) : []

  const entries = models.map((entry) => ({ value: entry.id, label: entry.id, testId }))

  return [{ value: "", label: emptyLabel, testId }, ...missing, ...entries]
}

export function effortOptions(
  selectedModel: ProfileModel | undefined,
  effort: ReasoningEffort | "",
  translate: Translate,
): LaunchOption<ReasoningEffort | "">[] {
  const testId = SESSION_CREATE_IDS.effortOption
  const listed = effort !== "" && !!selectedModel?.efforts.includes(effort)
  const missing = effort !== "" && !listed ? unavailable(effort, translate("sessionSelectedEffortUnavailable", { effort }), testId) : []
  const entries = selectedModel?.efforts.map((value) => ({ value, label: value, testId })) ?? []

  return [{ value: "", label: translate("sessionDefaultEffort"), testId }, ...missing, ...entries]
}
