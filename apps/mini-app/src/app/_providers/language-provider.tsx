import { I18nextProvider } from "react-i18next"
import { useLanguagePreference } from "@/shared/lib/hooks"
import type { LanguageProviderProps } from "./provider.types"

export function LanguageProvider({ children, initialLanguage }: LanguageProviderProps) {
  const instance = useLanguagePreference(initialLanguage)

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>
}
