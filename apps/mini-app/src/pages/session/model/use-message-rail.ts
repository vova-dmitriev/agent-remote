import { useEffect, useRef, type KeyboardEvent } from "react"
import type { HistoryMessage } from "@protocol"
import { messageRailScrollOffset } from "../lib/message-navigation"

export function useMessageRail(messages: HistoryMessage[], activeId: string | null, jump: (id: string) => void) {
  const rail = useRef<HTMLElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const selected = activeId ?? messages.at(-1)?.id

  useEffect(() => {
    const root = rail.current
    const node = selected ? buttons.current.get(selected) : null

    if (!root || !node) return
    root.scrollTop = messageRailScrollOffset(root, node)
  }, [selected])

  function register(id: string, node: HTMLButtonElement | null) {
    if (node) buttons.current.set(id, node)
    else buttons.current.delete(id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: messages.length - 1 }
    const move = moves[event.key]

    if (move === undefined) return
    event.preventDefault()
    const message = messages[Math.max(0, Math.min(messages.length - 1, move))]

    if (!message) return
    buttons.current.get(message.id)?.focus({ preventScroll: true })
    jump(message.id)
  }

  return { rail, selected, register, onKeyDown }
}
