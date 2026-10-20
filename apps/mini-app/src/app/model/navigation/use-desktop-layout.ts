import { useSyncExternalStore } from "react"
import { DESKTOP_SIDEBAR_QUERY } from "./values"

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_SIDEBAR_QUERY)

  media.addEventListener("change", onChange)

  return () => media.removeEventListener("change", onChange)
}

const wide = () => window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches

/**
 * The sidebar layout applies at ≥ 960 px on every host (desktop app, Telegram Mini App, browser); narrower windows keep
 * list/page navigation. Only the desktop host also keeps the selection in the URL hash (Telegram owns its hash).
 */
export function useDesktopLayout() {
  return useSyncExternalStore(subscribe, wide, () => false)
}
