import { useSyncExternalStore } from "react"
import { HostKind } from "@protocol"
import { useHost } from "@/shared/lib/host"
import { DESKTOP_SIDEBAR_QUERY } from "./values"

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_SIDEBAR_QUERY)

  media.addEventListener("change", onChange)

  return () => media.removeEventListener("change", onChange)
}

const wide = () => window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches

/** The sidebar layout belongs to the desktop host at ≥ 960 px; narrower windows and the Mini App keep list/page navigation. */
export function useDesktopLayout() {
  const host = useHost()
  const matches = useSyncExternalStore(subscribe, wide, () => false)

  return host.kind === HostKind.Desktop && matches
}
