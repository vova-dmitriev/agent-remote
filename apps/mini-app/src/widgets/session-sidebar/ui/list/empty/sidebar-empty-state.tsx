import { SearchX } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { mutedTextClass } from "@/shared/ui/text"
import { cn } from "@/shared/lib/utils"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"

interface SidebarEmptyStateProps {
  query: string
  onClear: () => void
}

export function SidebarEmptyState({ query, onClear }: SidebarEmptyStateProps) {
  const { t } = useTranslation()

  if (!query.trim()) {
    return (
      <p data-testid={SESSION_SIDEBAR_IDS.empty} className={cn(mutedTextClass, "flex-1 px-5 pt-6 text-center")}>
        {t("connectSession")}
      </p>
    )
  }

  return (
    <div data-testid={SESSION_SIDEBAR_IDS.empty} className="flex flex-1 flex-col items-center gap-2 px-6 pt-12 text-center">
      <SearchX aria-hidden="true" size={22} className="text-muted-foreground" />
      <p className="max-w-full text-[13px] font-medium break-words">{t("sidebarNoMatches", { query: query.trim() })}</p>
      <p className="text-xs text-muted-foreground">{t("sidebarNoMatchesHint")}</p>
      <Button variant="ghost" size="sm" className="mt-1 text-xs!" data-testid={SESSION_SIDEBAR_IDS.emptyClear} onClick={onClear}>
        {t("sidebarClearSearch")}
      </Button>
    </div>
  )
}
