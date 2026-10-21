import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import type { SidebarPageStatusProps } from "../list.types"

export function SidebarPageStatus({ loading, failed, onRetry }: SidebarPageStatusProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <p role="status" data-testid={SESSION_SIDEBAR_IDS.pageLoading} className="p-2 text-center text-xs text-muted-foreground">
        {t("sessionPagesLoading")}
      </p>
    )
  }

  if (failed) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="mx-auto my-2 flex text-xs!"
        data-testid={SESSION_SIDEBAR_IDS.pageRetry}
        onClick={onRetry}
      >
        {t("sessionPagesRetry")}
      </Button>
    )
  }

  return null
}
