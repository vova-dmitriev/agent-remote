import { Cpu, Gauge } from "lucide-react"
import type { AgentModel, ReasoningEffort } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { ChoiceDropdown } from "@/shared/ui/dropdown"
import { chipFieldClass, chipLabelClass } from "../config/chip-classes"
import { SESSION_CREATE_IDS } from "../config/test-ids"
import { effortOptions, modelOptions } from "../model/launch-options"

interface ModelEffortFieldsProps {
  /** The models to offer; none hides the fields. */
  models: AgentModel[] | undefined
  /** Whether the models can be picked now, e.g. the chosen profile is ready. */
  available: boolean
  /** The device's own sign-in: no model keeps the agent's default instead of asking for one. */
  native: boolean
  modelId: string
  selectedModel: AgentModel | undefined
  effort: ReasoningEffort | ""
  disabled: boolean
  onModelChange: (value: string) => void
  onEffortChange: (value: ReasoningEffort | "") => void
}

export function ModelEffortFields({
  models,
  available,
  native,
  modelId,
  selectedModel,
  effort,
  disabled,
  onModelChange,
  onEffortChange,
}: ModelEffortFieldsProps) {
  const { t } = useTranslation()

  if (!models) return null

  const emptyLabel = t(native ? "sessionDefaultModel" : "sessionChooseModel")

  return (
    <>
      <ChoiceDropdown
        value={modelId}
        onChange={onModelChange}
        label={t("sessionModel")}
        triggerLabel={modelId === "" ? emptyLabel : modelId}
        icon={Cpu}
        ids={SESSION_CREATE_IDS.model}
        className={chipFieldClass}
        labelClassName={chipLabelClass}
        disabled={disabled || !available}
        options={modelOptions(models, modelId, emptyLabel, t)}
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
          disabled={disabled || !available || !selectedModel}
          options={effortOptions(selectedModel, effort, t)}
        />
      ) : null}
    </>
  )
}
