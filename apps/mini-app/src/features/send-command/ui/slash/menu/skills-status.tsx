import { LoaderCircle } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SLASH_SKILL_IDS } from "@/features/send-command/config/slash-test-ids"
import type { SkillsMenuProps } from "../skills-menu.types"

export interface SkillsStatusProps {
  loading: boolean
  failed: boolean
  supported: boolean
  hasItems: boolean
  retry: SkillsMenuProps["retry"]
}

export function SkillsStatus({ loading, failed, supported, hasItems, retry }: SkillsStatusProps) {
  const { t } = useTranslation()

  if (!loading && !failed && hasItems) return null

  return (
    <div
      className="flex min-h-9 items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground"
      data-testid={SLASH_SKILL_IDS.status}
      role="status"
    >
      {loading ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {t(loading ? "slashSkillsLoading" : failed ? "slashSkillsFailed" : supported ? "slashSkillsEmpty" : "slashSkillsUnavailable")}
      {failed ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid={SLASH_SKILL_IDS.retry}
          onMouseDown={(event) => event.preventDefault()}
          onClick={retry}
        >
          {t("slashSkillsRetry")}
        </Button>
      ) : null}
    </div>
  )
}
