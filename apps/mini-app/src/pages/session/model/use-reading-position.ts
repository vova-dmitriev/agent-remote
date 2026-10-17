import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import type { Virtualizer } from "@tanstack/react-virtual"
import type { HistoryMessage } from "@protocol"
import { readPosition, writePosition, type ReadingPosition } from "@/shared/lib/reading-position"

import { FEED_READING_INSET, READING_RESTORE_STABLE_FRAMES, READING_RESTORE_MAX_FRAMES } from "../config/reading"

export function useReadingPosition(
  scope: string | undefined,
  messages: HistoryMessage[],
  enabled: boolean,
  ready: boolean,
  scroll: RefObject<HTMLDivElement | null>,
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>,
  follow: RefObject<boolean>,
  onRestored: () => void,
) {
  const [settled, setSettled] = useState(!scope)
  const initial = readPosition(scope)
  const initialized = useRef(false)
  const restoring = useRef(false)
  const bookmark = useRef<ReadingPosition | undefined>(initial)

  const capture = useCallback(() => {
    const root = scroll.current

    if (!scope || !enabled || !root || restoring.current || !initialized.current) return
    const item = virtualizer.getVirtualItems().find((row) => row.end > root.scrollTop + FEED_READING_INSET)

    if (item && messages[item.index]?.id === String(item.key)) {
      bookmark.current = { messageId: String(item.key), offset: root.scrollTop - item.start, cursor: messages[item.index]?.historyCursor }
      writePosition(scope, bookmark.current)
    }
  }, [scope, enabled, scroll, virtualizer, messages])

  useLayoutEffect(() => {
    if (!enabled || !ready || !messages.length || initialized.current) return
    const saved = readPosition(scope)

    initialized.current = true
    bookmark.current = saved
    follow.current = !saved
    restoring.current = true
    const found = saved ? messages.findIndex((message) => message.id === saved.messageId) : -1
    const index = found < 0 ? messages.length - 1 : found
    const offset = saved?.offset ?? 0
    let frame = 0
    let stable = 0
    let attempts = 0

    const restore = () => {
      const item = virtualizer.getVirtualItems().find((row) => row.key === messages[index]!.id)
      const root = scroll.current

      if (!root || !restoring.current) return
      if (found < 0) {
        const distance = root.scrollHeight - root.scrollTop - root.clientHeight

        stable = Math.abs(distance) < 1 ? stable + 1 : 0
        virtualizer.scrollToEnd()
      } else if (item) {
        const target = Math.max(0, item.start + offset)

        stable = Math.abs(root.scrollTop - target) < 1 ? stable + 1 : 0
        virtualizer.scrollToOffset(target)
      } else virtualizer.scrollToIndex(index, { align: "start" })
      if (stable >= READING_RESTORE_STABLE_FRAMES || ++attempts >= READING_RESTORE_MAX_FRAMES) {
        restoring.current = false
        setSettled(true)
        capture()
        onRestored()
      } else frame = requestAnimationFrame(restore)
    }

    frame = requestAnimationFrame(restore)

    return () => {
      cancelAnimationFrame(frame)
      if (restoring.current) initialized.current = false
      restoring.current = false
    }
  }, [capture, enabled, follow, messages, onRestored, ready, scope, scroll, virtualizer])

  useEffect(() => {
    const persist = () => {
      capture()
      if (scope && bookmark.current) writePosition(scope, bookmark.current)
    }

    window.addEventListener("pagehide", persist)

    return () => {
      window.removeEventListener("pagehide", persist)
      persist()
    }
  }, [capture, scope])

  const cancelRestore = useCallback(() => {
    restoring.current = false
    setSettled(true)
  }, [])

  return { capture, cancelRestore, restoring, settled }
}
