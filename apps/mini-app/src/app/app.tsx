import { SessionProvider } from "@/entities/session"
import { HostContext, telegramHost } from "@/shared/lib/host"
import { LanguageProvider } from "./_providers/language-provider"
import { QueryProvider } from "./_providers/query-provider"
import { ThemeProvider } from "./_providers/theme-provider"
import { RemoteApplication } from "./remote-application"
import type { AppProps } from "./model/app.types"

export function App({ host = telegramHost, initialLanguage, initialProviderFilter }: AppProps = {}) {
  return (
    <HostContext.Provider value={host}>
      <LanguageProvider {...(initialLanguage ? { initialLanguage } : {})}>
        <ThemeProvider>
          <QueryProvider>
            <SessionProvider {...(initialProviderFilter ? { initialProviderFilter } : {})}>
              <RemoteApplication />
            </SessionProvider>
          </QueryProvider>
        </ThemeProvider>
      </LanguageProvider>
    </HostContext.Provider>
  )
}
