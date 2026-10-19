import { useLayoutEffect, useMemo, useState, type RefObject } from "react"
import type { Virtualizer } from "@tanstack/react-virtual"
import type { RailViewport } from "@/pages/session/lib/rail-layout"

function sameViewport(a: RailViewport, b: RailViewport) {
  return a.scrollTop === b.scrollTop && a.clientHeight === b.clientHeight && a.scrollHeight === b.scrollHeight
}

/**
 * The feed as the rail maps it: every loaded message's virtual offset (measured or estimated, rendered or
 * not) and the scroll viewport, read once per animation frame on scroll and resize.
 */
export function useRailMap(
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>,
  scroll: RefObject<HTMLDivElement | null>,
  content: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const total = virtualizer.getTotalSize()
  // getTotalSize refreshes the measurements; the cache is replaced whenever a measurement or the count changes.
  const measurements = virtualizer.measurementsCache
  const starts = useMemo(() => Array.from(measurements, (item) => item.start), [measurements])
  const [viewport, setViewport] = useState<RailViewport>({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 })

  useLayoutEffect(() => {
    const root = scroll.current

    if (!enabled || !root) return
    let frame = 0

    const read = () => {
      frame = 0
      const next = { scrollTop: root.scrollTop, clientHeight: root.clientHeight, scrollHeight: root.scrollHeight }

      setViewport((previous) => (sameViewport(previous, next) ? previous : next))
    }

    const schedule = () => {
      frame ||= requestAnimationFrame(read)
    }

    read()
    root.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(schedule)

    observer.observe(root)
    if (content.current) observer.observe(content.current)

    return () => {
      cancelAnimationFrame(frame)
      root.removeEventListener("scroll", schedule)
      observer.disconnect()
    }
  }, [content, enabled, scroll])

  return { starts, total, viewport }
}
