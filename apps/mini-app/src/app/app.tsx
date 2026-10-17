import { SessionProvider } from "@/entities/session"
import { LanguageProvider } from "./_providers/language-provider"
import { QueryProvider } from "./_providers/query-provider"
import { ThemeProvider } from "./_providers/theme-provider"
import { RemoteApplication } from "./remote-application"

export function App() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <QueryProvider>
          <SessionProvider>
            <RemoteApplication />
          </SessionProvider>
        </QueryProvider>
      </ThemeProvider>
    </LanguageProvider>
  )
}
