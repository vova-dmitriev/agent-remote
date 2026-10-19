import { useContext } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { ThemePreference, ColorScheme } from "@protocol"
import { ThemeContext } from "@/shared/lib/theme"
import { useTranslation } from "@/shared/lib/hooks"
import { ChoiceDropdown } from "../dropdown"
import { THEME_SWITCHER_IDS } from "../test-ids"

export function ThemeSwitcher() {
  const { preference, setPreference } = useContext(ThemeContext)
  const { t } = useTranslation()

  const options = [
    { value: ThemePreference.Auto, label: t("themeAuto"), description: t("themeAutoHint"), icon: Monitor, testId: THEME_SWITCHER_IDS.auto },
    { value: ColorScheme.Light, label: t("themeLight"), icon: Sun, testId: THEME_SWITCHER_IDS.light },
    { value: ColorScheme.Dark, label: t("themeDark"), icon: Moon, testId: THEME_SWITCHER_IDS.dark },
  ] as const

  const selected = options.find((option) => option.value === preference)!

  return (
    <ChoiceDropdown
      value={preference}
      label={t("theme")}
      triggerLabel={selected.label}
      icon={selected.icon}
      compactChevron
      onChange={setPreference}
      ids={THEME_SWITCHER_IDS}
      options={options}
      compactIcon
    />
  )
}
