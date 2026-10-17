import type { ReactNode } from "react"
import type { Language } from "@/shared/lib/i18n"
import type { ThemePreference } from "@/shared/lib/theme"

export interface ProviderProps {
  children: ReactNode
}

export interface LanguageProviderProps extends ProviderProps {
  initialLanguage?: Language
}

export interface ThemeProviderProps extends ProviderProps {
  initialTheme?: ThemePreference
}
