import { Copy } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { DropdownItem, menuItemClass } from "@/shared/ui/dropdown"
import { SESSION_PAGE_IDS } from "@/pages/session/config/test-ids"
import type { CopySessionIdItemProps } from "../session-page.types"

/** Copies the agent's own id of the session (Claude's session id, Codex's thread id), to continue it elsewhere. */
export function CopySessionIdItem({ id, onCopied }: CopySessionIdItemProps) {
  const { t } = useTranslation()

  return (
    <DropdownItem asChild onSelect={() => void navigator.clipboard?.writeText(id).then(onCopied)}>
      <Button type="button" variant="ghost" className={menuItemClass} data-testid={SESSION_PAGE_IDS.copyId}>
        <Copy aria-hidden="true" size={16} />
        {t("copySessionId")}
      </Button>
    </DropdownItem>
  )
}
