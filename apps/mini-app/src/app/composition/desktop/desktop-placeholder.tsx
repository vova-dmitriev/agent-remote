import { MousePointerClick } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { DESKTOP_IDS } from "@/app/config/test-ids"

/** Desktop main pane while no session is selected (`#/`). */
export function DesktopPlaceholder() {
  const { t } = useTranslation()

  return (
    <div className="grid min-h-[60dvh] place-items-center p-8" data-testid={DESKTOP_IDS.placeholder}>
      <div className="flex max-w-xs flex-col items-center gap-2 text-center">
        <MousePointerClick aria-hidden="true" size={22} className="text-muted-foreground" />
        <h2 className="text-[15px]">{t("sidebarNoSelection")}</h2>
        <p className="text-[13px] text-muted-foreground">{t("sidebarNoSelectionHint")}</p>
      </div>
    </div>
  )
}
