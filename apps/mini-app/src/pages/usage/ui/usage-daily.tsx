import { formatCost, formatTokens, totalTokens } from "@/entities/usage"
import { useTranslation } from "@/shared/lib/hooks"
import { USAGE_PAGE_IDS } from "../config/test-ids"
import type { UsageDailyProps } from "./usage-page.types"

/** Tokens per local day as bars, oldest on the left; each bar's title carries the day's numbers. */
export function UsageDaily({ days }: UsageDailyProps) {
  const { t, language } = useTranslation()
  const largest = Math.max(1, ...days.map((day) => totalTokens(day.tokens)))

  if (days.length < 2) return null

  return (
    <section className="grid gap-[8px]" data-testid={USAGE_PAGE_IDS.daily}>
      <h2 className="text-[13px] font-semibold text-muted-foreground">{t("usageDaily")}</h2>
      <div className="flex h-[72px] items-end gap-[2px]">
        {days.map((day) => {
          const tokens = totalTokens(day.tokens)
          const cost = formatCost(day.costUsd, language)

          return (
            <div
              key={day.day}
              className="min-w-[2px] flex-1 rounded-t-[2px] bg-primary/70"
              style={{ height: `${Math.max(2, (tokens / largest) * 100)}%` }}
              title={[day.day, formatTokens(tokens, language), cost].filter(Boolean).join(" · ")}
              data-testid={USAGE_PAGE_IDS.day}
              data-day={day.day}
            />
          )
        })}
      </div>
    </section>
  )
}
