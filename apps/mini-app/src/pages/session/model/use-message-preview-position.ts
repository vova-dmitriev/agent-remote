import { useLayoutEffect, useRef, useState } from "react"

export function useMessagePreviewPosition(anchor: HTMLElement) {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 8, width: 300 })

  useLayoutEffect(() => {
    const node = root.current

    if (!node) return

    function update() {
      if (!node || !anchor.isConnected) return
      const rect = anchor.getBoundingClientRect()
      const size = node.getBoundingClientRect()
      const viewport = window.visualViewport
      const leftEdge = viewport?.offsetLeft ?? 0
      const topEdge = viewport?.offsetTop ?? 0
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth)
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight)
      // The rail sits on the feed's left edge, so the preview opens to the right of its marker.
      const available = Math.max(0, rightEdge - rect.right - 18)
      const width = Math.min(360, available || rightEdge - leftEdge - 16)
      const left = Math.max(leftEdge + 8, Math.min(rect.right + 10, rightEdge - width - 8))
      const top = Math.max(topEdge + 8, Math.min(rect.top + rect.height / 2 - size.height / 2, bottomEdge - size.height - 8))

      setPosition((previous) =>
        previous.left === left && previous.top === top && previous.width === width ? previous : { left, top, width },
      )
    }

    update()
    const observer = new ResizeObserver(update)

    observer.observe(node)
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    window.visualViewport?.addEventListener("resize", update)
    window.visualViewport?.addEventListener("scroll", update)

    return () => {
      observer.disconnect()
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
      window.visualViewport?.removeEventListener("resize", update)
      window.visualViewport?.removeEventListener("scroll", update)
    }
  }, [anchor])

  return { root, position }
}
