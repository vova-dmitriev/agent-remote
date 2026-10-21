import { PreviewSource } from "../config/message-navigation"

export function navigationScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth"
}

export function previewDismissal() {
  const dismissed: Record<PreviewSource, string | null> = { hover: null, focus: null, touch: null }

  return {
    dismiss(id: string, source?: PreviewSource) {
      if (!source || source === PreviewSource.Hover) dismissed.hover = id
      if (!source || source === PreviewSource.Focus) dismissed.focus = id
    },
    allows(id: string, source: PreviewSource) {
      // A tap asks for its preview explicitly, whatever was dismissed before.
      if (source === PreviewSource.Touch) return true

      return source === PreviewSource.Hover ? dismissed.hover === null : dismissed.focus !== id
    },
    leave(source: PreviewSource) {
      dismissed[source] = null
    },
  }
}
