import { createInstance, type i18n } from "i18next"
import { Language } from "@protocol"
import { en } from "./dictionaries/en"
import { ru } from "./dictionaries/ru"

export function createLanguageInstance(language: Language): i18n {
  const instance = createInstance()

  void instance.init({
    lng: language,
    fallbackLng: Language.Ru,
    supportedLngs: [Language.Ru, Language.En],
    resources: { en: { translation: en }, ru: { translation: ru } },
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })

  return instance
}
