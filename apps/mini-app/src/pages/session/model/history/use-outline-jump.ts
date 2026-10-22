import { useCallback, useLayoutEffect, useState } from "react"
import type { HistoryMessage } from "@protocol"

/**
 * Jumps to a marked message: a loaded one at once; one outside the loaded window after the window around it loads.
 * A failed load leaves the feed where it was.
 */
export function useOutlineJump(
  messages: HistoryMessage[],
  outline: readonly HistoryMessage[],
  jump: (id: string) => void,
  around: ((id: string, cursor?: string) => Promise<unknown>) | undefined,
) {
  const [pending, setPending] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!pending || !messages.some((message) => message.id === pending)) return

    // The new window renders and anchors first; the jump then lands on its measured rows.
    const frame = requestAnimationFrame(() => {
      setPending(null)
      jump(pending)
    })

    return () => cancelAnimationFrame(frame)
  }, [messages, pending, jump])

  return useCallback(
    (id: string) => {
      const target = messages.some((message) => message.id === id) ? undefined : outline.find((message) => message.id === id)

      if (!target || !around) return jump(id)
      setPending(id)

      void around(id, target.historyCursor).then((loaded) => {
        if (loaded === false) setPending(null)
      })
    },
    [messages, outline, jump, around],
  )
}
