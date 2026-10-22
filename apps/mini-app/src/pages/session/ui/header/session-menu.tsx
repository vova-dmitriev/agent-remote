import { useState } from "react"
import { ChartColumn } from "lucide-react"
import { ConnectionStatus, DeviceStatus } from "@protocol"
import { SessionActions } from "@/features/send-command"
import { RemoveSessionItems } from "@/features/remove-session"
import { ModelDialog, ModelMenuItem } from "@/features/switch-model"
import type { SessionMenuProps } from "../session-page.types"
import { useTranslation } from "@/shared/lib/hooks"
import { Toast } from "@/shared/ui/toast"
import { Button } from "@/shared/ui/button"
import { DropdownItem, menuItemClass } from "@/shared/ui/dropdown"
import { SESSION_PAGE_IDS } from "@/pages/session/config/test-ids"
import { CopySessionIdItem } from "./copy-session-id-item"
import { sessionModels } from "./session-models"

/**
 * The session's "…" menu: its model (picked in a dialog, which outlives the closed menu), interrupting the agent,
 * and removing the session when the page can.
 */
export function SessionMenu({ session, state, controller, switchModel, remove, onRemoved, onOpenUsage }: SessionMenuProps) {
  const { t } = useTranslation()
  const [choosing, setChoosing] = useState(false)
  /** How many times the id was copied: each copy shows its toast again. */
  const [copies, setCopies] = useState(0)
  const nativeId = session.claudeSessionId ?? ("threadId" in session.target ? session.target.threadId : null)
  const choice = switchModel ? sessionModels(session, state) : null
  const deviceStatus = state.snapshot?.deviceStatus ?? DeviceStatus.Offline

  return (
    <>
      <SessionActions session={session} controller={controller} connection={state.connection} deviceStatus={deviceStatus}>
        {choice && switchModel ? (
          <ModelMenuItem session={session} models={choice.models} controller={switchModel} onOpen={() => setChoosing(true)} />
        ) : null}
        {nativeId ? <CopySessionIdItem id={nativeId} onCopied={() => setCopies((count) => count + 1)} /> : null}
        {onOpenUsage ? (
          <DropdownItem asChild onSelect={() => onOpenUsage(session.id)}>
            <Button type="button" variant="ghost" className={menuItemClass} data-testid={SESSION_PAGE_IDS.usage}>
              <ChartColumn aria-hidden="true" size={16} />
              {t("sessionUsage")}
            </Button>
          </DropdownItem>
        ) : null}
        {remove ? (
          <RemoveSessionItems
            session={session}
            controller={remove}
            disabled={state.connection !== ConnectionStatus.Online || deviceStatus !== DeviceStatus.Online}
            onRemoved={onRemoved}
          />
        ) : null}
      </SessionActions>
      {copies ? (
        <Toast show={String(copies)} testId={SESSION_PAGE_IDS.idCopied}>
          {t("sessionIdCopied")}
        </Toast>
      ) : null}
      {choice && switchModel ? (
        <ModelDialog
          open={choosing}
          onClose={() => setChoosing(false)}
          session={session}
          models={choice.models}
          controller={switchModel}
          disabled={choice.disabled}
        />
      ) : null}
    </>
  )
}
