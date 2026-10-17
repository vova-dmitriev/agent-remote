import { useEffect, useState } from "react"
import { SessionStatus, type Session } from "@protocol"
import { activityKey } from "@/pages/session/lib/activity"

export function useActivity(session: Session, available: boolean) {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!available || session.status !== SessionStatus.Running || session.currentActivity) return

    const timer = setInterval(() => setNow(Date.now()), 10000)

    return () => clearInterval(timer)
  }, [available, session.status, session.currentActivity])

  return activityKey(session, available, Math.max(now, session.lastEventAt))
}
