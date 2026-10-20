import { ColorScheme, ThemePreference } from "@protocol"

interface TelegramApp {
  initData: string
  initDataUnsafe?: { user?: { language_code?: string } }
  ready(): void
  expand(): void
  themeParams: Record<string, string>
  colorScheme?: ColorScheme
  onEvent(name: string, callback: () => void): void
  offEvent(name: string, callback: () => void): void
  HapticFeedback?: { impactOccurred(style: string): void }
  BackButton?: { show(): void; hide(): void; onClick(callback: () => void): void; offClick(callback: () => void): void }
  isVersionAtLeast?(version: string): boolean
}
declare global {
  interface Window {
    Telegram?: { WebApp: TelegramApp }
  }
}

export function telegram() {
  return window.Telegram?.WebApp
}

export function applyTelegramTheme(preference: ThemePreference) {
  const app = telegram()
  const system = window.matchMedia("(prefers-color-scheme: dark)")
  const root = document.documentElement
  const applied = new Set<string>()

  app?.ready()
  app?.expand()

  const update = () => {
    const hasTelegramTheme = !!app?.initData || Object.keys(app?.themeParams ?? {}).length > 0
    const automatic = (hasTelegramTheme ? app?.colorScheme : undefined) ?? (system.matches ? ColorScheme.Dark : ColorScheme.Light)
    const theme = preference === ThemePreference.Auto ? automatic : preference

    root.dataset.themePreference = preference
    root.classList.toggle("dark", theme === ThemePreference.Dark)
    root.style.colorScheme = theme

    for (const name of applied) root.style.removeProperty(name)
    applied.clear()

    if (preference !== ThemePreference.Auto) return

    for (const [name, value] of Object.entries(app?.themeParams ?? {})) {
      const property = "--tg-theme-" + name.replaceAll("_", "-")

      root.style.setProperty(property, value)
      applied.add(property)
    }
  }

  update()
  app?.onEvent("themeChanged", update)
  system.addEventListener("change", update)

  return () => {
    app?.offEvent("themeChanged", update)
    system.removeEventListener("change", update)
    for (const name of applied) root.style.removeProperty(name)
  }
}
