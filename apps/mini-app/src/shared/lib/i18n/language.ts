import { Language } from "@protocol"

const key = "claude-remote.language.v1"

export function resolveLanguage(saved: unknown, telegram?: string, browser?: string): Language {
  if (saved === Language.Ru || saved === Language.En) return saved

  for (const value of [telegram, browser]) {
    const match = value?.match(/^(ru|en)(?:[-_]|$)/i)

    if (match) return match[1]!.toLowerCase() as Language
  }

  return Language.Ru
}

export function persistLanguage(language: Language) {
  try {
    window.localStorage.setItem(key, language)
  } catch {
    /* Storage can be disabled in a Telegram webview. */
  }
}
