import { createRoot } from "react-dom/client"
import { z } from "zod"
import { App } from "@/app/app"
import { resolveLanguage } from "@/shared/lib/i18n"
import { createChromeHost } from "@extension/client"
import { chromeApi } from "@extension/config/chrome-api"
import { ExtensionApiValue, ExtensionConfig } from "@extension/config/values"
import { ProviderFilterValue } from "@protocol"
import "@/app/styles/globals.css"

z.config({ jitless: true })

async function bootstrap() {
  const chrome = chromeApi()

  await chrome.storage.local.setAccessLevel({ accessLevel: ExtensionApiValue.TrustedContexts })
  const saved = await chrome.storage.local.get([ExtensionConfig.LanguageKey, ExtensionConfig.ProviderFilterKey])
  const language = resolveLanguage(saved[ExtensionConfig.LanguageKey], undefined, navigator.language)
  const filter = saved[ExtensionConfig.ProviderFilterKey]
  const initialProviderFilter = Object.values(ProviderFilterValue).find((value) => value === filter) ?? ProviderFilterValue.All

  document.documentElement.lang = language

  createRoot(document.getElementById("root")!).render(
    <App host={createChromeHost()} initialLanguage={language} initialProviderFilter={initialProviderFilter} />,
  )
}

void bootstrap()
