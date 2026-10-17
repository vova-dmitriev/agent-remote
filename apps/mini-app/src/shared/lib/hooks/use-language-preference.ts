import { useState, useEffect } from "react"
import type { i18n } from "i18next"
import { createLanguageInstance, resolveLanguage, persistLanguage, type Language } from "@/shared/lib/i18n"
import { telegram } from "@/shared/lib/telegram"

export function useLanguagePreference(initialLanguage?: Language): i18n {
  const [instance] = useState(() =>
    createLanguageInstance(initialLanguage ?? resolveLanguage(null, telegram()?.initDataUnsafe?.user?.language_code, navigator.language)),
  )

  useEffect(() => {
    const syncLanguage = (value: string) => {
      const language = resolveLanguage(value)

      document.documentElement.lang = language
      persistLanguage(language)
    }

    document.documentElement.lang = resolveLanguage(instance.resolvedLanguage)
    instance.on("languageChanged", syncLanguage)

    return () => {
      instance.off("languageChanged", syncLanguage)
    }
  }, [instance])

  return instance
}
