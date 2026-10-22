import { formatCost, formatTokens, totalTokens } from "@/entities/usage"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { USAGE_PAGE_IDS } from "../config/test-ids"
import { dayLabel } from "../lib/labels"
import type { UsageDailyProps } from "./usage-page.types"

/** Tokens per local day as bars, oldest on the left; picking a bar narrows the report to that day. */
export function UsageDaily({ days, picked, onPick }: UsageDailyProps) {
  const { t, language } = useTranslation()
  const largest = Math.max(1, ...days.map((day) => totalTokens(day.tokens)))
  const pickedDay = days.find((day) => day.day === picked)

  const summary = (day: (typeof days)[number]) =>
    [dayLabel(day.day, language), formatTokens(totalTokens(day.tokens), language), formatCost(day.costUsd, language)]
      .filter(Boolean)
      .join(" · ")

  if (days.length < 2 && !pickedDay) return null

  return (
    <section className="grid gap-[8px]" data-testid={USAGE_PAGE_IDS.daily}>
      <div className="flex items-baseline justify-between gap-[12px]">
        <h2 className="text-[13px] font-semibold text-muted-foreground">{t("usageDaily")}</h2>
        <span className="truncate text-[12px] text-muted-foreground tabular-nums" data-testid={USAGE_PAGE_IDS.dayDetail}>
          {pickedDay ? summary(pickedDay) : t("usageDailyHint")}
        </span>
      </div>
      <div className="flex h-[96px] items-end gap-[3px]">
        {days.map((day) => (
          <button
            key={day.day}
            type="button"
            className="group flex h-full min-w-[4px] flex-1 items-end rounded-[3px] focus-visible:outline-2 focus-visible:outline-ring"
            title={summary(day)}
            aria-label={summary(day)}
            aria-pressed={day.day === picked}
            data-testid={USAGE_PAGE_IDS.day}
            data-day={day.day}
            onClick={() => onPick(day.day)}
          >
            <span
              className={cn(
                "block w-full rounded-t-[3px] bg-primary/70 transition-colors group-hover:bg-primary",
                picked && (day.day === picked ? "bg-primary" : "bg-primary/25"),
              )}
              style={{ height: `${Math.max(3, (totalTokens(day.tokens) / largest) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
        <span>{dayLabel(days[0]!.day, language)}</span>
        <span>{dayLabel(days.at(-1)!.day, language)}</span>
      </div>
    </section>
  )
}
