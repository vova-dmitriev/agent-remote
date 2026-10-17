import { useTranslation as useI18nextTranslation } from "react-i18next"
import { selectPreference } from "@/shared/lib/preferences"
import { resolveLanguage, type Language, type Translate } from "@/shared/lib/i18n"

export function useTranslation() {
  const { t, i18n } = useI18nextTranslation()
  const language = resolveLanguage(i18n.resolvedLanguage)

  const setLanguage = (value: Language) => {
    void i18n.changeLanguage(value)
    selectPreference({ language: value })
  }

  const translate: Translate = (key, parameters = {}) => t(key, parameters)

  return { language, setLanguage, t: translate }
}
