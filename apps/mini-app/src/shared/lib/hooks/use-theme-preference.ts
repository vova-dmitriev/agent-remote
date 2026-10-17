import { useCallback, useEffect, useState } from "react"
import { ThemePreference } from "@protocol"
import { selectPreference } from "@/shared/lib/preferences"
import { applyTelegramTheme } from "@/shared/lib/telegram"
import { persistTheme } from "@/shared/lib/theme"

export function useThemePreference(initialTheme?: ThemePreference) {
  const [preference, setTheme] = useState(() => initialTheme ?? ThemePreference.Auto)

  useEffect(() => applyTelegramTheme(preference), [preference])

  const restorePreference = useCallback((value: ThemePreference) => {
    persistTheme(value)
    setTheme(value)
  }, [])

  const setPreference = useCallback(
    (value: ThemePreference) => {
      restorePreference(value)
      selectPreference({ theme: value })
    },
    [restorePreference],
  )

  return { preference, setPreference, restorePreference }
}
