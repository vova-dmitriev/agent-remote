import { Archive, EyeOff, Power } from "lucide-react"
import { SessionRemoval } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { DropdownItem, menuItemClass } from "@/shared/ui/dropdown"
import { cn } from "@/shared/lib/utils"
import { REMOVE_SESSION_IDS as IDS } from "../config/test-ids"
import type { RemoveSessionItemsProps } from "./remove-session-items.types"

/** The session menu's ways to remove a session: hide it, archive a Codex thread in Codex, or end it. */
export function RemoveSessionItems({ session, controller, disabled, onRemoved }: RemoveSessionItemsProps) {
  const { t } = useTranslation()
  const off = disabled || controller.busy

  const items = [
    { mode: SessionRemoval.Hide, Icon: EyeOff, label: t("hideSession"), testId: IDS.hide },
    // Claude keeps no archive: for its sessions archiving is hiding.
    ...("threadId" in session.target
      ? [{ mode: SessionRemoval.Archive, Icon: Archive, label: t("archiveSession"), testId: IDS.archive }]
      : []),
    { mode: SessionRemoval.End, Icon: Power, label: t("endSession"), testId: IDS.end },
  ]

  return items.map(({ mode, Icon, label, testId }) => (
    <DropdownItem
      key={mode}
      asChild
      disabled={off}
      onSelect={() => {
        if (!off) void controller.remove(mode).then(onRemoved, () => undefined)
      }}
    >
      <Button
        type="button"
        variant="ghost"
        className={cn(
          menuItemClass,
          mode === SessionRemoval.End &&
            "text-danger hover:bg-transparent hover:text-danger dark:hover:bg-transparent dark:data-[highlighted]:bg-highlight",
        )}
        data-testid={testId}
        disabled={off}
      >
        <Icon aria-hidden="true" size={16} />
        {label}
      </Button>
    </DropdownItem>
  ))
}
