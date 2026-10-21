import { formatCost, formatTokens, totalTokens } from "@/entities/usage"
import { useTranslation } from "@/shared/lib/hooks"
import { USAGE_PAGE_IDS } from "../config/test-ids"
import { USAGE_SECTION_ROWS } from "../config/values"
import { unknownRow } from "../lib/labels"
import type { UsageRowsProps } from "./usage-page.types"

/** One breakdown (models, projects, sessions): name, tokens with a bar against the largest, and cost. */
export function UsageRows({ section, title, rows }: UsageRowsProps) {
  const { t, language } = useTranslation()
  const shown = rows.slice(0, USAGE_SECTION_ROWS)
  const largest = Math.max(1, ...shown.map((row) => totalTokens(row.tokens)))

  if (!shown.length) return null

  return (
    <section className="grid gap-[8px]" data-testid={USAGE_PAGE_IDS.section} data-section={section}>
      <h2 className="text-[13px] font-semibold text-muted-foreground">{t(title)}</h2>
      <ul className="grid gap-[10px]">
        {shown.map((row) => {
          const tokens = totalTokens(row.tokens)
          const cost = formatCost(row.costUsd, language)

          return (
            <li key={row.key} className="grid gap-[4px]" data-testid={USAGE_PAGE_IDS.row} data-key={row.key}>
              <div className="flex items-baseline gap-[12px] text-[13px]">
                <span className="min-w-0 flex-1 truncate" title={row.key}>
                  {unknownRow(row) ? t("usageUnknown") : row.label}
                </span>
                <span className="text-muted-foreground tabular-nums">{formatTokens(tokens, language)}</span>
                <span className="w-[64px] text-right tabular-nums" title={cost ? undefined : t("usageNoPrice")}>
                  {cost ?? "—"}
                </span>
              </div>
              <div className="h-[3px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(tokens / largest) * 100}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
