import { useMemo, useState } from "react"
import type { Session } from "@protocol"
import { useStableCallback } from "@/shared/lib/hooks"
import { useRuntime } from "@/shared/lib/runtime"

/** A pin change not yet in the snapshot: what was asked for, and what the snapshot said when it was asked. */
interface PendingPin {
  pinned: boolean
  from: boolean
}

const NO_PENDING: ReadonlyMap<string, PendingPin> = new Map()
const isPinned = (session: Session) => session.pinned === true

function withPinned(session: Session, pinned: boolean): Session {
  const { pinned: _pinned, ...rest } = session

  return pinned ? { ...rest, pinned: true } : rest
}

/**
 * Pins and unpins sessions. The device holds pins and reports them in its snapshot, so a toggle shows at once and
 * lasts while the snapshot still says what it said at the click; any newer snapshot value wins.
 */
export function usePinSession(sessions: Session[]) {
  const runtime = useRuntime()
  const [pending, setPending] = useState(NO_PENDING)
  const [failed, setFailed] = useState(false)

  const shown = useMemo(
    () =>
      pending.size
        ? sessions.map((session) => {
            const change = pending.get(session.id)

            return change && change.from === isPinned(session) ? withPinned(session, change.pinned) : session
          })
        : sessions,
    [sessions, pending],
  )

  const toggle = useStableCallback(async (session: Session) => {
    const lease = runtime.current()
    const pinned = !isPinned(session)
    const source = sessions.find((item) => item.id === session.id) ?? session

    setFailed(!lease)
    if (!lease) return
    setPending((current) => new Map(current).set(session.id, { pinned, from: isPinned(source) }))

    try {
      await lease.client.pinSession(session.id, session.generation, pinned)
    } catch {
      setPending((current) => {
        const next = new Map(current)

        next.delete(session.id)

        return next
      })

      setFailed(true)
    }
  })

  return { sessions: shown, toggle, failed }
}
