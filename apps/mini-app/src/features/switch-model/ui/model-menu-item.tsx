import { Cpu } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { DropdownItem, menuItemClass } from "@/shared/ui/dropdown"
import { SWITCH_MODEL_IDS as IDS } from "../config/test-ids"
import { modelChoice } from "../lib/model-choice"
import type { ModelMenuItemProps } from "./model-dialog.types"

/** The "…" menu's way to the model dialog, naming the session's current model. */
export function ModelMenuItem({ session, models, controller, onOpen }: ModelMenuItemProps) {
  const { t } = useTranslation()
  const { current } = modelChoice(session, models, controller)

  return (
    <DropdownItem asChild onSelect={onOpen}>
      <Button type="button" variant="ghost" className={menuItemClass} data-testid={IDS.open}>
        <Cpu aria-hidden="true" size={16} />
        {t("sessionModelMenu", { model: current || t("sessionDefaultModel") })}
      </Button>
    </DropdownItem>
  )
}
