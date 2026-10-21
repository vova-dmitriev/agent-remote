import { ShieldCheck } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { RULES_BADGE_IDS } from "@/entities/rule/config/test-ids"
import type { RulesBadgeProps } from "./rules-badge.types"

/** 🛡 with the number of rules that can stop a session's commands. */
export function RulesBadge({ count, onOpen }: RulesBadgeProps) {
  const { t } = useTranslation()

  return (
    <Button
      variant="ghost"
      className="h-[28px] flex-none gap-[4px] px-[6px] text-[11px] text-muted-foreground tabular-nums session:text-[10px]"
      data-testid={RULES_BADGE_IDS.root}
      data-count={count}
      title={t("rulesBadge", { count })}
      aria-label={t("rulesBadge", { count })}
      onClick={onOpen}
    >
      <ShieldCheck aria-hidden="true" size={14} />
      {count}
    </Button>
  )
}
