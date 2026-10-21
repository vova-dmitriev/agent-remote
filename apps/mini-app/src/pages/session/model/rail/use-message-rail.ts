import { PointerKind } from "@/shared/lib/pointer"
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"
import { RAIL_HIT_SIZE, RAIL_TICK_GAP } from "@/pages/session/config/message-navigation"
import { nearestGroup, railGroupOf, railGroups } from "@/pages/session/lib/rail-layout"
import type { MessageRailProps } from "@/pages/session/model/types/message-rail.types"
import { useRailFocus } from "./use-rail-focus"

type RailInput = Pick<MessageRailProps, "messages" | "starts" | "total" | "viewport" | "activeId" | "jump">

const COARSE_POINTER = "(pointer: coarse)"

const keyMoves: Record<string, (index: number, last: number) => number> = {
  ArrowUp: (index) => index - 1,
  ArrowDown: (index) => index + 1,
  Home: () => 0,
  End: (_, last) => last,
}

function subscribeCoarse(onChange: () => void) {
  const media = window.matchMedia(COARSE_POINTER)

  media.addEventListener("change", onChange)

  return () => media.removeEventListener("change", onChange)
}

/** A finger needs a full-size target per marker; a mouse picks the nearest tick, so ticks may sit close. */
const useMarkerGap = () =>
  useSyncExternalStore(
    subscribeCoarse,
    () => (window.matchMedia(COARSE_POINTER).matches ? RAIL_HIT_SIZE : RAIL_TICK_GAP),
    () => RAIL_HIT_SIZE,
  )

export function useMessageRail({ messages, starts, total, viewport, activeId, jump }: RailInput) {
  const track = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const [height, setHeight] = useState(0)
  /** Pointer position on the track, for the magnification and the nearest marker; null when away. */
  const [pointer, setPointer] = useState<number | null>(null)
  const gap = useMarkerGap()

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
  const groups = useMemo(() => railGroups(starts, extent, height, gap), [starts, extent, height, gap])
  const selectedId = activeId ?? messages.at(-1)?.id
  const selectedIndex = useMemo(() => messages.findIndex((message) => message.id === selectedId), [messages, selectedId])
  const selected = railGroupOf(groups, selectedIndex)
  const hovered = pointer === null ? -1 : nearestGroup(groups, pointer)
  const focus = useRailFocus(groups, messages, buttons)

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

  /** Mouse and pen only: a finger taps the marker under it instead. */
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const node = track.current

    if (event.pointerType === PointerKind.Touch || !node) return
    setPointer(event.clientY - node.getBoundingClientRect().top)
  }

  /** Moving between a marker and the free track stays on the rail. */
  function onPointerLeave(event: PointerEvent<HTMLElement>) {
    if (!(event.relatedTarget instanceof Node && track.current?.contains(event.relatedTarget))) setPointer(null)
  }

  const hoveredMessage = hovered >= 0 ? messages[groups[hovered]!.first] : undefined

  /** A click on the free track jumps to the nearest marker, as hovering it showed. */
  function onTrackClick() {
    if (hoveredMessage) jump(hoveredMessage.id)
  }

  return {
    track,
    groups,
    gap,
    pointer,
    hovered,
    hoveredNode: hoveredMessage ? (buttons.current.get(hoveredMessage.id) ?? null) : null,
    hoveredMessage,
    selectedId,
    selected,
    focus,
    register,
    onKeyDown,
    pointerHandlers: { onPointerMove, onPointerLeave },
    onTrackClick,
  }
}
