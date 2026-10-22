import { X } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { USAGE_PAGE_IDS } from "@/pages/usage/config/test-ids"
import type { UsageFiltersProps } from "../usage-page.types"
import { dayLabel } from "@/pages/usage/lib/labels"

/** The picked session and day as chips; each clears with its cross. */
export function UsageFilters({ session, day, onClearSession, onClearDay }: UsageFiltersProps) {
  const { t, language } = useTranslation()

  const chips = [
    { key: "session", label: session === undefined ? undefined : t("usageSessionFilter", { title: session }), clear: onClearSession },
    { key: "day", label: day === undefined ? undefined : dayLabel(day, language), clear: onClearDay },
  ].filter((chip) => chip.label !== undefined)

  if (!chips.length) return null

  return (
    <div className="flex flex-wrap gap-[6px]">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-[28px] max-w-full items-center gap-[4px] rounded-full bg-highlight-subtle pr-[4px] pl-[12px] text-[12px]"
          data-testid={USAGE_PAGE_IDS.filter}
          data-filter={chip.key}
        >
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            className="grid size-[20px] place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={t("usageClearFilter")}
            data-testid={USAGE_PAGE_IDS.filterClear}
            data-filter={chip.key}
            onClick={chip.clear}
          >
            <X aria-hidden="true" size={13} />
          </button>
        </span>
      ))}
    </div>
  )
}
