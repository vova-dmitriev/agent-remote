import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { railBand, railGroupOf, railGroups, railSeekOffset } from "@/pages/session/lib/rail-layout"
import type { MessageRailProps } from "@/pages/session/model/types/message-rail.types"

type RailInput = Pick<MessageRailProps, "messages" | "starts" | "total" | "viewport" | "activeId" | "jump" | "seek">

const keyMoves: Record<string, (index: number, last: number) => number> = {
  ArrowUp: (index) => index - 1,
  ArrowDown: (index) => index + 1,
  Home: () => 0,
  End: (_, last) => last,
}

export function useMessageRail({ messages, starts, total, viewport, activeId, jump, seek }: RailInput) {
  const track = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const node = track.current

    if (!node) return
    const update = () => setHeight(node.clientHeight)

    update()
    const observer = new ResizeObserver(update)

    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  const extent = Math.max(total, viewport.clientHeight)
  const groups = useMemo(() => railGroups(starts, extent, height), [starts, extent, height])
  const selectedId = activeId ?? messages.at(-1)?.id
  const selectedIndex = useMemo(() => messages.findIndex((message) => message.id === selectedId), [messages, selectedId])
  const selected = railGroupOf(groups, selectedIndex)
  const band = railBand(viewport, height)

  function register(id: string, node: HTMLButtonElement | null) {
    if (node) buttons.current.set(id, node)
    else buttons.current.delete(id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = keyMoves[event.key]?.(index, groups.length - 1)

    if (move === undefined) return
    event.preventDefault()
    const group = groups[Math.max(0, Math.min(groups.length - 1, move))]
    const message = group ? messages[group.first] : undefined

    if (!message) return
    buttons.current.get(message.id)?.focus({ preventScroll: true })
    jump(message.id)
  }

  function onTrackClick(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()

    seek(railSeekOffset(event.clientY - rect.top, rect.height, viewport))
  }

  return { track, groups, band, selectedId, selected, register, onKeyDown, onTrackClick }
}
