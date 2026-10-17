import { CapabilityKey, DeviceStatus, CommandActionType } from "@protocol"
import { canSend, sessionPermissions } from "@/entities/session"
import { SESSION_PAGE_IDS } from "@/pages/session/config/test-ids"
import { PermissionCard } from "./permission-card"
import type { SessionPermissionsProps } from "./types"

export function SessionPermissions({ session, state, controller }: SessionPermissionsProps) {
  const permissions = sessionPermissions(state, session)

  const disabled =
    controller.busy || !canSend(state.connection, state.snapshot?.deviceStatus ?? DeviceStatus.Offline, session, CapabilityKey.Permission)

  if (!permissions.length) return null

  return (
    <div className="session-permissions" data-testid={SESSION_PAGE_IDS.permissions}>
      {permissions.map((permission) => (
        <PermissionCard
          key={permission.requestId}
          permission={permission}
          disabled={disabled}
          decide={(decision) => void controller.action({ type: CommandActionType.Permission, requestId: permission.requestId, decision })}
        />
      ))}
    </div>
  )
}
