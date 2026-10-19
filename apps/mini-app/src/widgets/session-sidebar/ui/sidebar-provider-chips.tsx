import { ProviderFilterValue } from "@/entities/session"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSION_SIDEBAR_IDS } from "../config/test-ids"
import type { SidebarProviderChipsProps } from "./session-sidebar.types"

const chips = [
  { value: ProviderFilterValue.All, testId: SESSION_SIDEBAR_IDS.providerAll },
  { value: ProviderFilterValue.Claude, testId: SESSION_SIDEBAR_IDS.providerClaude },
  { value: ProviderFilterValue.Codex, testId: SESSION_SIDEBAR_IDS.providerCodex },
] as const

export function SidebarProviderChips({ value, onChange }: SidebarProviderChipsProps) {
  const { t } = useTranslation()

  return (
    <div role="group" aria-label={t("sessionProvider")} data-testid={SESSION_SIDEBAR_IDS.providers} className="flex gap-1">
      {chips.map((chip) => (
        <Button
          key={chip.value}
          variant="ghost"
          size="sm"
          aria-pressed={value === chip.value}
          data-testid={chip.testId}
          className="h-6 rounded-full border border-transparent px-2.5 text-xs! font-medium text-muted-foreground aria-pressed:border-primary/30 aria-pressed:bg-accent aria-pressed:text-foreground"
          onClick={() => onChange(chip.value)}
        >
          {chip.value === ProviderFilterValue.All ? t("allAgents") : chip.value}
        </Button>
      ))}
    </div>
  )
}
