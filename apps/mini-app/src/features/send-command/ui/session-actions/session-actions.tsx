import { MoreHorizontal, Square } from "lucide-react"
import { CapabilityKey, SessionStatus, CommandActionType } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { DropdownMenu, DropdownTrigger, DropdownItem, MenuContent, menuItemClass } from "@/shared/ui/dropdown"
import { cn } from "@/shared/lib/utils"
import { canSend } from "@/entities/session"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"
import type { SessionActionsProps } from "./session-actions.types"

export function SessionActions({ session, controller, connection, deviceStatus, children }: SessionActionsProps) {
  const { t } = useTranslation()

  const disabled =
    controller.busy || session.status === SessionStatus.Ended || !canSend(connection, deviceStatus, session, CapabilityKey.Interrupt)

  if (!session.capabilities.interrupt && !children) return null

  return (
    <div className="flex-none" data-testid={COMMAND_IDS.actions}>
      <DropdownMenu modal={false}>
        <DropdownTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-[36px] text-muted-foreground hover:text-muted-foreground"
            aria-label={t("sessionActions")}
            title={t("sessionActions")}
            data-testid={COMMAND_IDS.actionsTrigger}
          >
            <MoreHorizontal aria-hidden="true" size={20} />
          </Button>
        </DropdownTrigger>
        <MenuContent data-testid={COMMAND_IDS.actionsPanel}>
          {session.capabilities.interrupt ? (
            <DropdownItem
              asChild
              disabled={disabled}
              onSelect={() => {
                if (!disabled) void controller.action({ type: CommandActionType.Interrupt })
              }}
            >
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  menuItemClass,
                  "text-danger hover:bg-transparent hover:text-danger dark:hover:bg-transparent dark:data-[highlighted]:bg-highlight",
                )}
                data-testid={COMMAND_IDS.interrupt}
                disabled={disabled}
              >
                <Square aria-hidden="true" size={16} />
                {t(CapabilityKey.Interrupt)}
              </Button>
            </DropdownItem>
          ) : null}
          {children}
        </MenuContent>
      </DropdownMenu>
    </div>
  )
}
