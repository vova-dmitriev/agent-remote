import { Cpu, Gauge } from "lucide-react"
import type { ReasoningEffort } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { ChoiceDropdown } from "@/shared/ui/dropdown"
import { SWITCH_MODEL_IDS as IDS } from "../config/test-ids"
import type { ModelChipsProps } from "./model-chips.types"

/** The session's model and effort in its header; picking one switches the session from its next turn. */
export function ModelChips({ session, models, controller, disabled }: ModelChipsProps) {
  const { t } = useTranslation()
  const chosen = controller.chosen(session.id)
  const current = chosen?.model ?? session.model ?? ""
  const model = models.find((entry) => entry.id === current)
  const effort: ReasoningEffort | "" = chosen?.model === current ? (chosen.effort ?? "") : ""
  const off = disabled || controller.busy
  // A model the session runs that the list does not offer (a full Claude name, say) stays visible.
  const unlisted = current !== "" && !model ? [{ value: current, label: current, testId: IDS.modelOption, disabled: true }] : []

  return (
    <>
      <ChoiceDropdown
        value={current}
        onChange={(id) => void controller.switchModel(session, { model: id })}
        label={t("sessionModel")}
        triggerLabel={current || t("sessionDefaultModel")}
        icon={Cpu}
        ids={IDS.model}
        compactIcon
        compactChevron
        disabled={off}
        options={[...unlisted, ...models.map((entry) => ({ value: entry.id, label: entry.id, testId: IDS.modelOption }))]}
      />
      {model?.efforts.length ? (
        <ChoiceDropdown
          value={effort}
          onChange={(value) => void controller.switchModel(session, { model: model.id, ...(value ? { effort: value } : {}) })}
          label={t("sessionEffort")}
          triggerLabel={effort || t("sessionDefaultEffort")}
          icon={Gauge}
          ids={IDS.effort}
          compactIcon
          compactChevron
          disabled={off}
          options={model.efforts.map((value) => ({ value, label: value, testId: IDS.effortOption }))}
        />
      ) : null}
    </>
  )
}
