import { useLayoutEffect } from "react"
import type { Virtualizer } from "@tanstack/react-virtual"

/**
 * Measures every rendered row once the feed is at rest. A smooth `scrollToIndex`/`scrollToOffset` drops the
 * measurements of rows far from its target, and its ResizeObserver does not report them again, so a row that
 * stays rendered keeps its estimated size and the next row is drawn over it. `resizeItem` ignores unchanged sizes.
 */
export function useRenderedRowSizes(virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>) {
  useLayoutEffect(() => {
    if (virtualizer.isScrolling) return

    // After the commit, so a scroll correction may re-render the feed synchronously.
    const frame = requestAnimationFrame(() => {
      virtualizer.elementsCache.forEach((row) => {
        if (row.isConnected)
          virtualizer.resizeItem(virtualizer.indexFromElement(row), virtualizer.options.measureElement(row, undefined, virtualizer))
      })
    })

    return () => cancelAnimationFrame(frame)
  })
}
