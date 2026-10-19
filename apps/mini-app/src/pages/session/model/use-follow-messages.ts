import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual"
import { HistoryDirection, type HistoryMessage } from "@protocol"
import { useHistoryPagination } from "./history/use-history-pagination"
import { useReadingPosition } from "./use-reading-position"
import { navigationScrollBehavior } from "../lib/message-navigation"

import { FEED_READING_INSET } from "../config/reading"
import type { HistoryPageLoader } from "./types/session-feed.types"

export function useFollowMessages(
  messages: HistoryMessage[],
  enabled = true,
  scope?: string,
  ready = true,
  onHistoryPage?: HistoryPageLoader,
) {
  const scroll = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const viewportTop = useRef<number | null>(null)
  const follow = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)

  const updateActive = useCallback(
    (items: VirtualItem[]) => {
      const root = scroll.current

      if (!root) return
      const first = items.find((item) => item.end > root.scrollTop + FEED_READING_INSET)

      const last = messages.at(-1)
      const id = root.scrollHeight - root.scrollTop - root.clientHeight <= 1 && last ? last.id : first?.key

      if (id !== undefined) setActiveId(String(id))
    },
    [messages],
  )

  const getItemKey = useCallback((index: number) => messages[index]!.id, [messages])

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: messages.length,
    enabled,
    getScrollElement: () => scroll.current,
    getItemKey,
    estimateSize: () => 160,
    measureElement: (element, entry) => entry?.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height,
    overscan: 3,
    gap: 13,
    useAnimationFrameWithResizeObserver: true,
    paddingStart: FEED_READING_INSET,
    paddingEnd: FEED_READING_INSET,
    scrollPaddingStart: FEED_READING_INSET,
    anchorTo: "end",
    followOnAppend: !messages.at(-1)?.historyCursor,
    scrollEndThreshold: 80,
    onChange: (instance) => updateActive(instance.getVirtualItems()),
  })

  // Preserve the reading line when a measured row above it changes, including after backward jumps.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.end <= (instance.scrollOffset ?? 0) + FEED_READING_INSET

  const updatePosition = useCallback(() => {
    const node = scroll.current

    if (!node) return
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    setAtBottom(follow.current)
    if (enabled) updateActive(virtualizer.getVirtualItems())
  }, [enabled, updateActive, virtualizer])

  const { capture, cancelRestore, restoring, settled } = useReadingPosition(
    scope,
    messages,
    enabled,
    ready,
    scroll,
    virtualizer,
    follow,
    updatePosition,
  )

  useLayoutEffect(() => {
    if (ready && !restoring.current && messages.at(-1)?.historyCursor) updatePosition()
  }, [messages, ready, restoring, updatePosition])

  const schedulePage = useHistoryPagination(scroll, restoring, ready && enabled, onHistoryPage)

  const onScroll = useCallback(() => {
    if (restoring.current) return
    capture()
    updatePosition()
    schedulePage()
  }, [capture, restoring, updatePosition, schedulePage])

  const toBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      cancelRestore()
      follow.current = true
      if (enabled) virtualizer.scrollToEnd({ behavior })
      else scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior })
      setAtBottom(true)
    },
    [enabled, virtualizer, cancelRestore],
  )

  const latest = useCallback(
    async (behavior: ScrollBehavior) => {
      await onHistoryPage?.(HistoryDirection.Latest)
      requestAnimationFrame(() => toBottom(behavior))
    },
    [onHistoryPage, toBottom],
  )

  const jump = useCallback(
    (id: string) => {
      const index = messages.findIndex((message) => message.id === id)

      if (index < 0) return
      cancelRestore()
      follow.current = false
      const behavior = navigationScrollBehavior(window.matchMedia("(prefers-reduced-motion: reduce)").matches)

      virtualizer.scrollToIndex(index, { align: "start", behavior })
      schedulePage()
      setActiveId(id)
    },
    [messages, virtualizer, cancelRestore, schedulePage],
  )

  const seek = useCallback(
    (offset: number) => {
      cancelRestore()
      follow.current = false

      virtualizer.scrollToOffset(offset, {
        behavior: navigationScrollBehavior(window.matchMedia("(prefers-reduced-motion: reduce)").matches),
      })

      schedulePage()
    },
    [virtualizer, cancelRestore, schedulePage],
  )

  useLayoutEffect(() => {
    if (follow.current) toBottom()
  }, [enabled, toBottom])

  const preserveViewport = useCallback(() => {
    const root = scroll.current

    if (!root) return
    const top = root.getBoundingClientRect().top
    const delta = viewportTop.current === null ? 0 : top - viewportTop.current

    viewportTop.current = top
    if (enabled && !follow.current && !restoring.current && delta) {
      virtualizer.scrollToOffset(root.scrollTop + delta)
      capture()
    } else if (!enabled && follow.current) root.scrollTop = root.scrollHeight
  }, [capture, enabled, restoring, virtualizer])

  useLayoutEffect(preserveViewport)

  useLayoutEffect(() => {
    const root = scroll.current
    const inner = content.current

    if (!root || !inner) return
    const observer = new ResizeObserver(preserveViewport)

    observer.observe(root)
    observer.observe(inner)

    return () => observer.disconnect()
  }, [preserveViewport])

  return { scroll, content, settled, onScroll, onUserScroll: cancelRestore, atBottom, activeId, jump, seek, toBottom, latest, virtualizer }
}
