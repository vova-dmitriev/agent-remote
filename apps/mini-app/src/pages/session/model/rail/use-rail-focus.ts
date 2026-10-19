import { useLayoutEffect, useRef, type FocusEvent, type RefObject } from "react"
import type { HistoryMessage } from "@protocol"
import { railGroupOf, type RailGroup } from "@/pages/session/lib/rail-layout"

/**
 * Keeps keyboard focus on the rail when markers regroup. A jump measures new rows, which can merge or split
 * markers and unmount the focused one; focus then moves to the marker that now covers the same message.
 */
export function useRailFocus(groups: RailGroup[], messages: HistoryMessage[], buttons: RefObject<Map<string, HTMLButtonElement>>) {
  const focused = useRef<string | null>(null)
  const restoring = useRef(false)

  useLayoutEffect(() => {
    const id = focused.current
    const active = document.activeElement

    if (!id || (active && active !== document.body)) return
    const index = messages.findIndex((message) => message.id === id)
    const group = groups[railGroupOf(groups, index)]
    const target = group ? messages[group.first] : undefined

    restoring.current = true
    if (target) buttons.current.get(target.id)?.focus({ preventScroll: true })
    restoring.current = false
  }, [buttons, groups, messages])

  function enter(id: string) {
    if (!restoring.current) focused.current = id
  }

  function leave(event: FocusEvent<HTMLButtonElement>) {
    const node = event.currentTarget

    if (event.relatedTarget) focused.current = null
    // A blur without a new target either left the page's focusable elements or came from unmounting the marker.
    else
      queueMicrotask(() => {
        if (node.isConnected) focused.current = null
      })
  }

  return { enter, leave }
}
