import { ProviderFilterValue } from "@/pages/sessions/config/values"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { ProviderFilterProps } from "./provider-filter.types"

export function ProviderFilter({ value, onChange }: ProviderFilterProps) {
  const { t } = useTranslation()

  return (
    <div
      className="mb-[8px] flex w-fit gap-[2px] rounded-[12px] bg-surface p-[3px]"
      data-testid={SESSIONS_PAGE_IDS.filters}
      aria-label={t("sessionProvider")}
    >
      <Button
        variant="ghost"
        className={filterClass}
        data-testid={SESSIONS_PAGE_IDS.filterAll}
        aria-pressed={value === ProviderFilterValue.All}
        onClick={() => onChange(ProviderFilterValue.All)}
      >
        {t("allAgents")}
      </Button>
      <Button
        variant="ghost"
        className={filterClass}
        data-testid={SESSIONS_PAGE_IDS.filterClaude}
        aria-pressed={value === ProviderFilterValue.Claude}
        onClick={() => onChange(ProviderFilterValue.Claude)}
      >
        Claude
      </Button>
      <Button
        variant="ghost"
        className={filterClass}
        data-testid={SESSIONS_PAGE_IDS.filterCodex}
        aria-pressed={value === ProviderFilterValue.Codex}
        onClick={() => onChange(ProviderFilterValue.Codex)}
      >
        Codex
      </Button>
    </div>
  )
}

const filterClass =
  "h-[30px] rounded-[9px] px-[14px] py-0 text-[12px] text-muted-foreground hover:text-muted-foreground aria-pressed:bg-accent dark:hover:aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:shadow-[inset_0_0_0_1px_var(--accent)]"
