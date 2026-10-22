import { useCallback, useLayoutEffect, useRef, useState } from "react"
import type { HistoryMessage } from "@protocol"

/**
 * Jumps to a marked message: a loaded one at once; one outside the loaded window after the window around it loads,
 * straight to it, since the rows between are new anyway. `pending` names the message while its window loads, so the
 * rail and the feed answer the tap at once. A failed load leaves the feed where it was.
 * The landing holds the target for a few frames: the replaced window anchors to its end and may page in what
 * follows, which would otherwise carry the feed away from it.
 */
/** Frames a jump into a freshly loaded window keeps landing on its target (about 0.1 s). */
const OUTLINE_LANDING_FRAMES = 6

export function useOutlineJump(
  messages: HistoryMessage[],
  outline: readonly HistoryMessage[],
  jump: (id: string, behavior?: ScrollBehavior) => void,
  around: ((id: string, cursor?: string) => Promise<unknown>) | undefined,
) {
  const [pending, setPending] = useState<string | null>(null)
  const latest = useRef(jump)

  useLayoutEffect(() => {
    latest.current = jump
  }, [jump])

  useLayoutEffect(() => {
    if (!pending || !messages.some((message) => message.id === pending)) return
    let held = 0
    let frame = 0

    // The feed stays covered until the landing ends, so the corrections never show.
    const land = () => {
      latest.current(pending, "auto")
      if (++held < OUTLINE_LANDING_FRAMES) frame = requestAnimationFrame(land)
      else setPending(null)
    }

    frame = requestAnimationFrame(land)

    return () => cancelAnimationFrame(frame)
  }, [messages, pending])

  /** `cursor` locates a message outside the outline (a search match); without one the outline's is used. */
  const reach = useCallback(
    (id: string, cursor?: string) => {
      if (messages.some((message) => message.id === id) || !around) return jump(id)
      setPending(id)

      void around(id, cursor ?? outline.find((message) => message.id === id)?.historyCursor).then((loaded) => {
        if (loaded === false) setPending(null)
      })
    },
    [messages, outline, jump, around],
  )

  return { reach, pending }
}
