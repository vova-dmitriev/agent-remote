import { ConnectionStatus, DeviceStatus } from "@protocol"
import { SessionActions } from "@/features/send-command"
import { RemoveSessionItems } from "@/features/remove-session"
import type { SessionMenuProps } from "./session-page.types"

/** The session's "…" menu: interrupting the agent, and removing the session when the page can. */
export function SessionMenu({ session, controller, remove, connection, deviceStatus, onRemoved }: SessionMenuProps) {
  return (
    <SessionActions session={session} controller={controller} connection={connection} deviceStatus={deviceStatus}>
      {remove ? (
        <RemoveSessionItems
          session={session}
          controller={remove}
          disabled={connection !== ConnectionStatus.Online || deviceStatus !== DeviceStatus.Online}
          onRemoved={onRemoved}
        />
      ) : null}
    </SessionActions>
  )
}
