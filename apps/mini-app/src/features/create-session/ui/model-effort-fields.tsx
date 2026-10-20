import { Cpu, Gauge } from "lucide-react"
import type { ExecutionProfileSummary, ReasoningEffort } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { ChoiceDropdown } from "@/shared/ui/dropdown"
import { chipFieldClass, chipLabelClass } from "../config/chip-classes"
import { SESSION_CREATE_IDS } from "../config/test-ids"
import { effortOptions, modelOptions } from "../model/launch-options"

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
      <ChoiceDropdown
        value={modelId}
        onChange={onModelChange}
        label={t("sessionModel")}
        triggerLabel={modelId === "" ? t("sessionChooseModel") : modelId}
        icon={Cpu}
        ids={SESSION_CREATE_IDS.model}
        className={chipFieldClass}
        labelClassName={chipLabelClass}
        disabled={disabled || !profileAvailable || !profile}
        options={modelOptions(profile, modelId, t)}
      />
      {modelId !== "" && (effort !== "" || selectedModel?.efforts.length) ? (
        <ChoiceDropdown
          value={effort}
          onChange={onEffortChange}
          label={t("sessionEffort")}
          triggerLabel={effort === "" ? t("sessionDefaultEffort") : effort}
          icon={Gauge}
          ids={SESSION_CREATE_IDS.effort}
          className={chipFieldClass}
          labelClassName={chipLabelClass}
          disabled={disabled || !profileAvailable || !selectedModel}
          options={effortOptions(selectedModel, effort, t)}
        />
      ) : null}
    </>
  )
}
