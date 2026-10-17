import { PreviewSource } from "../config/message-navigation"

export function navigationScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth"
}

export function previewDismissal() {
  const dismissed: Record<PreviewSource, string | null> = { hover: null, focus: null }

  return {
    dismiss(id: string, source?: PreviewSource) {
      if (!source || source === PreviewSource.Hover) dismissed.hover = id
      if (!source || source === PreviewSource.Focus) dismissed.focus = id
    },
    allows(id: string, source: PreviewSource) {
      return source === PreviewSource.Hover ? dismissed.hover === null : dismissed.focus !== id
    },
    leave(source: PreviewSource) {
      dismissed[source] = null
    },
  }
}

interface MessageRailViewport {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

interface MessageRailMarker {
  offsetTop: number
  offsetHeight: number
}

export function messageRailScrollOffset(root: MessageRailViewport, node: MessageRailMarker): number {
  if (node.offsetTop >= root.scrollTop && node.offsetTop + node.offsetHeight <= root.scrollTop + root.clientHeight) return root.scrollTop
  const centered = node.offsetTop - (root.clientHeight - node.offsetHeight) / 2

  return Math.max(0, Math.min(centered, root.scrollHeight - root.clientHeight))
}
