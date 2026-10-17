import { StatusConfidence, SessionStatus, type Session } from "@protocol"

const labels = {
  command: "activityCommand",
  read: "activityRead",
  write: "activityWrite",
  search: "activitySearch",
  web: "activityWeb",
  tool: "activityTool",
} as const

export function activityKey(session: Session, available: boolean, now = Date.now()) {
  if (!available || session.status !== SessionStatus.Running || session.errorCode) return null

  if (session.currentActivity) return labels[session.currentActivity.kind]

  return session.statusConfidence === StatusConfidence.Observed && now - session.lastEventAt < 120000 ? "activityWorking" : null
}
