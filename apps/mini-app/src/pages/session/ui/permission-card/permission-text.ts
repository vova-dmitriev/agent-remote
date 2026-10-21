import type { PendingPermission } from "@protocol"

/** What a permission asks about: a rule stop shows its command line, an agent's own prompt its tool input. */
export function permissionText(permission: PendingPermission) {
  const input = permission.input as { command?: unknown; cmd?: unknown } | null
  const command = input?.command ?? input?.cmd

  return permission.rule && typeof command === "string" ? command : JSON.stringify(permission.input, null, 2)
}
