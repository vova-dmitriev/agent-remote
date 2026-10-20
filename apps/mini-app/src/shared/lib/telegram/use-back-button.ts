import { useEffect, useLayoutEffect, useRef } from "react"
import { telegram } from "./webapp"

/** Bot API version that introduced the native back button. */
const BACK_BUTTON_VERSION = "6.1"

/** Shows Telegram's native back button while the calling view is mounted; outside Telegram it does nothing. */
export function useTelegramBackButton(onBack: () => void) {
  const callback = useRef(onBack)

  useLayoutEffect(() => {
    callback.current = onBack
  }, [onBack])

  useEffect(() => {
    const app = telegram()
    const button = app?.BackButton

    if (!button || !app.initData || app.isVersionAtLeast?.(BACK_BUTTON_VERSION) === false) return
    const handle = () => callback.current()

    button.onClick(handle)
    button.show()

    return () => {
      button.offClick(handle)
      button.hide()
    }
  }, [])
}
