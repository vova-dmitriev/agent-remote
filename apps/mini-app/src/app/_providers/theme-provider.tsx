import { useThemePreference } from "@/shared/lib/hooks"
import { ThemeContext } from "@/shared/lib/theme"
import type { ThemeProviderProps } from "./provider.types"

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const value = useThemePreference(initialTheme)

  return <ThemeContext value={value}>{children}</ThemeContext>
}
