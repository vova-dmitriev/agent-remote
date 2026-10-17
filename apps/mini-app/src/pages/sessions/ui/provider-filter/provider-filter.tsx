import { ProviderFilterValue } from "@/pages/sessions/config/values"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { ProviderFilterProps } from "./provider-filter.types"

export function ProviderFilter({ value, onChange }: ProviderFilterProps) {
  const { t } = useTranslation()

  return (
    <div className="provider-filter" data-testid={SESSIONS_PAGE_IDS.filters} aria-label={t("sessionProvider")}>
      <Button
        variant="ghost"
        data-testid={SESSIONS_PAGE_IDS.filterAll}
        aria-pressed={value === ProviderFilterValue.All}
        onClick={() => onChange(ProviderFilterValue.All)}
      >
        {t("allAgents")}
      </Button>
      <Button
        variant="ghost"
        data-testid={SESSIONS_PAGE_IDS.filterClaude}
        aria-pressed={value === ProviderFilterValue.Claude}
        onClick={() => onChange(ProviderFilterValue.Claude)}
      >
        Claude
      </Button>
      <Button
        variant="ghost"
        data-testid={SESSIONS_PAGE_IDS.filterCodex}
        aria-pressed={value === ProviderFilterValue.Codex}
        onClick={() => onChange(ProviderFilterValue.Codex)}
      >
        Codex
      </Button>
    </div>
  )
}
