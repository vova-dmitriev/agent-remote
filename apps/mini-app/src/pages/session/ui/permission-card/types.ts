import { RemotePermissionDecision, type PendingPermission, type Session } from "@protocol"
import type { SessionState } from "@/entities/session"
import type { CommandController } from "@/features/send-command"

export interface PermissionCardProps {
  permission: PendingPermission
  disabled: boolean
  decide: (decision: RemotePermissionDecision) => void
}

export interface SessionPermissionsProps {
  session: Session
  state: SessionState
  controller: CommandController
}
