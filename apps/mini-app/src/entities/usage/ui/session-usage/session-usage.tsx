import type { SessionUsage as Usage } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_USAGE_IDS } from "@/entities/usage/config/test-ids"
import { formatCost, formatTokens, totalTokens } from "@/entities/usage/lib/format"

/** " · 1.2M tokens · ≈ $4.20 at API prices", after the session's update time. */
export function SessionUsage({ usage }: { usage: Usage | undefined }) {
  const { t, language } = useTranslation()

  if (!usage) return null

  const cost = formatCost(usage.costUsd, language)

  return (
    <span data-testid={SESSION_USAGE_IDS.root}>
      {" · "}
      <span data-testid={SESSION_USAGE_IDS.tokens}>
        {t("usageSessionLine", { tokens: formatTokens(totalTokens(usage.tokens), language) })}
      </span>
      {cost ? (
        <span data-testid={SESSION_USAGE_IDS.cost}>
          {" · "}
          {t("usageSessionCost", { cost })}
        </span>
      ) : null}
    </span>
  )
}
