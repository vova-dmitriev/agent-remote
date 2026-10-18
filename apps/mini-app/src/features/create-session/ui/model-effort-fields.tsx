import type { ExecutionProfileSummary, ReasoningEffort } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_CREATE_IDS } from "../config/test-ids"

interface ModelEffortFieldsProps {
  profileId: string
  profileAvailable: boolean
  profile: ExecutionProfileSummary | undefined
  modelId: string
  selectedModel: ExecutionProfileSummary["models"][number] | undefined
  effort: ReasoningEffort | ""
  disabled: boolean
  onModelChange: (value: string) => void
  onEffortChange: (value: ReasoningEffort | "") => void
}

export function ModelEffortFields({
  profileId,
  profileAvailable,
  profile,
  modelId,
  selectedModel,
  effort,
  disabled,
  onModelChange,
  onEffortChange,
}: ModelEffortFieldsProps) {
  const { t } = useTranslation()

  if (profileId === "") return null

  return (
    <>
      <label className="block text-sm">
        {t("sessionModel")}
        <select
          className="mt-1 w-full rounded-md border border-border bg-background p-2"
          data-testid={SESSION_CREATE_IDS.model}
          value={modelId}
          onChange={(event) => onModelChange(event.target.value)}
          disabled={disabled || !profileAvailable || !profile}
        >
          <option value="">{t("sessionChooseModel")}</option>
          {modelId !== "" && (!profile || !profile.models.some((entry) => entry.id === modelId)) ? (
            <option value={modelId} disabled>
              {t("sessionSelectedModelUnavailable", { model: modelId })}
            </option>
          ) : null}
          {profile?.models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
            </option>
          ))}
        </select>
      </label>
      {modelId !== "" && (effort !== "" || selectedModel?.efforts.length) ? (
        <label className="block text-sm">
          {t("sessionEffort")}
          <select
            className="mt-1 w-full rounded-md border border-border bg-background p-2"
            data-testid={SESSION_CREATE_IDS.effort}
            value={effort}
            onChange={(event) => onEffortChange(event.target.value as ReasoningEffort | "")}
            disabled={disabled || !profileAvailable || !selectedModel}
          >
            <option value="">{t("sessionDefaultEffort")}</option>
            {effort !== "" && (!selectedModel || !selectedModel.efforts.includes(effort)) ? (
              <option value={effort} disabled>
                {t("sessionSelectedEffortUnavailable", { effort })}
              </option>
            ) : null}
            {selectedModel?.efforts.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  )
}
