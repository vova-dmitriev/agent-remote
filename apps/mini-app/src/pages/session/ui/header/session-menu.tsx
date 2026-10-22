import { useState } from "react"
import { ConnectionStatus, DeviceStatus } from "@protocol"
import { SessionActions } from "@/features/send-command"
import { RemoveSessionItems } from "@/features/remove-session"
import { ModelDialog, ModelMenuItem } from "@/features/switch-model"
import type { SessionMenuProps } from "../session-page.types"
import { sessionModels } from "./session-models"

/**
 * The session's "…" menu: its model (picked in a dialog, which outlives the closed menu), interrupting the agent,
 * and removing the session when the page can.
 */
export function SessionMenu({ session, state, controller, switchModel, remove, onRemoved }: SessionMenuProps) {
  const [choosing, setChoosing] = useState(false)
  const choice = switchModel ? sessionModels(session, state) : null
  const deviceStatus = state.snapshot?.deviceStatus ?? DeviceStatus.Offline

  return (
    <>
      <SessionActions session={session} controller={controller} connection={state.connection} deviceStatus={deviceStatus}>
        {choice && switchModel ? (
          <ModelMenuItem session={session} models={choice.models} controller={switchModel} onOpen={() => setChoosing(true)} />
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
