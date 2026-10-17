import { Globe } from "lucide-react"
import { Language } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { ChoiceDropdown } from "./dropdown"
import { LANGUAGE_SWITCHER_IDS } from "./test-ids"

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation()

  return (
    <ChoiceDropdown
      value={language}
      label={t("language")}
      triggerLabel={language.toUpperCase()}
      icon={Globe}
      onChange={setLanguage}
      ids={LANGUAGE_SWITCHER_IDS}
      options={[
        { value: Language.Ru, label: t("languageRussian"), testId: LANGUAGE_SWITCHER_IDS.ru },
        { value: Language.En, label: t("languageEnglish"), testId: LANGUAGE_SWITCHER_IDS.en },
      ]}
    />
  )
}
