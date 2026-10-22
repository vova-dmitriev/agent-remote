import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { z } from "zod"
import { App } from "@/app/app"
import { linkedHost } from "@/app/host"
import { LinkClientPage } from "@/pages/link-client"
import { resolveLanguage } from "@/shared/lib/i18n"
import type { HostAdapter } from "@/shared/lib/host"
import { createChromeHost } from "@extension/client"
import { chromeApi } from "@extension/config/chrome-api"
import { ExtensionApiValue, ExtensionConfig } from "@extension/config/values"
import { ProviderFilterValue } from "@protocol"
import "@/app/styles/globals.css"

z.config({ jitless: true })

/** The server this build links to; a build without one uses only the Agent Remote companion on this Mac. */
const server = import.meta.env.VITE_EXTENSION_SERVER_ORIGIN as string | undefined

async function bootstrap() {
  const chrome = chromeApi()

  await chrome.storage.local.setAccessLevel({ accessLevel: ExtensionApiValue.TrustedContexts })

  const saved = await chrome.storage.local.get([
    ExtensionConfig.LanguageKey,
    ExtensionConfig.ProviderFilterKey,
    ExtensionConfig.LinkKey,
    ExtensionConfig.CompanionKey,
  ])

  const language = resolveLanguage(saved[ExtensionConfig.LanguageKey], undefined, navigator.language)
  const filter = saved[ExtensionConfig.ProviderFilterKey]
  const initialProviderFilter = Object.values(ProviderFilterValue).find((value) => value === filter) ?? ProviderFilterValue.All
  const root = createRoot(document.getElementById("root")!)
  const companion = createChromeHost()
  const link = saved[ExtensionConfig.LinkKey]

  document.documentElement.lang = language

  const render = (host: HostAdapter, content?: ReactNode) =>
    root.render(
      <App host={host} initialLanguage={language} initialProviderFilter={initialProviderFilter} {...(content ? { content } : {})} />,
    )

  // Linking or choosing the companion reloads the page, which starts again from what the storage now holds.
  const remember = (values: Record<string, unknown>) => void chrome.storage.local.set(values).then(() => location.reload())

  if (!server || saved[ExtensionConfig.CompanionKey] === true) {
    render(companion)
  } else if (typeof link === "string" && link) {
    render(
      linkedHost({
        server,
        refresh: link,
        onExpired: () => void chrome.storage.local.remove(ExtensionConfig.LinkKey).then(() => location.reload()),
        ...(companion.openFullTab ? { openFullTab: companion.openFullTab } : {}),
        ...(companion.saveProviderFilter ? { saveProviderFilter: companion.saveProviderFilter } : {}),
      }),
    )
  } else {
    render(
      companion,
      <LinkClientPage
        server={server}
        onLinked={(refresh) => remember({ [ExtensionConfig.LinkKey]: refresh })}
        onUseCompanion={() => remember({ [ExtensionConfig.CompanionKey]: true })}
      />,
    )
  }
}

void bootstrap()
