import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Modal } from "@/shared/ui/modal"
import { SWITCH_MODEL_IDS as IDS } from "../config/test-ids"
import { modelChoice } from "../lib/model-choice"
import { ChoiceList } from "./choice-list"
import type { ModelDialogProps } from "./model-dialog.types"

/** Picks the session's model and reasoning effort; a pick switches the session from its next turn. */
export function ModelDialog({ open, onClose, session, models, controller, disabled }: ModelDialogProps) {
  const { t } = useTranslation()
  const { current, model, effort, ids } = modelChoice(session, models, controller)
  const off = disabled || controller.busy
  const offered = new Set(models.map((entry) => entry.id))

  return (
    <Modal open={open} title={t("sessionModelDialog")} onClose={onClose} testId={IDS.dialog}>
      <ChoiceList
        label={t("sessionModel")}
        values={ids}
        current={current}
        unavailable={ids.filter((id) => !offered.has(id))}
        disabled={off}
        testId={IDS.models}
        optionTestId={IDS.modelOption}
        onPick={(id) => void controller.switchModel(session, { model: id })}
      />
      {model?.efforts.length ? (
        <ChoiceList
          label={t("sessionEffort")}
          values={model.efforts}
          current={effort}
          disabled={off}
          testId={IDS.efforts}
          optionTestId={IDS.effortOption}
          onPick={(value) => {
            // The list hands back a string; the effort is the model's own value it names.
            const picked = model.efforts.find((entry) => entry === value)

            void controller.switchModel(session, { model: model.id, ...(picked ? { effort: picked } : {}) })
          }}
        />
      ) : null}
      <div className="mt-[16px] flex justify-end">
        <Button type="button" data-testid={IDS.done} onClick={onClose}>
          {t("sessionModelDone")}
        </Button>
      </div>
    </Modal>
  )
}
