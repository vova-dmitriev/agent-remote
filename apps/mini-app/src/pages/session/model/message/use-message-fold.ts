import { useLayoutEffect, useRef, useState } from "react"

/** A message taller than this can be folded. */
const LONG_MESSAGE_HEIGHT = 360

// ponytail: module-level, so a folded message stays folded when the virtual list unmounts and remounts its row.
const folded = new Set<string>()

/** Whether a long message is folded, and the toggle that folds or unfolds it. */
export function useMessageFold(id: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [collapsed, setCollapsed] = useState(() => folded.has(id))

  useLayoutEffect(() => {
    const node = ref.current

    if (!node) return

    const measure = () => setLong(node.scrollHeight > LONG_MESSAGE_HEIGHT)
    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  const toggle = () => {
    const next = !collapsed

    if (next) folded.add(id)
    else folded.delete(id)

    setCollapsed(next)

    // Folding a message read from its end keeps its start on screen.
    if (next) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest" }))
  }

  return { ref, long, collapsed: long && collapsed, toggle }
}
