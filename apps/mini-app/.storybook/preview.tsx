import type { Preview } from "@storybook/react-vite"
import { mswLoader } from "msw-storybook-addon/csf3"
import { SessionProvider } from "@/entities/session"
import { LanguageProvider } from "../src/app/_providers/language-provider"
import { ThemeProvider } from "../src/app/_providers/theme-provider"
import { QueryProvider } from "../src/app/_providers/query-provider"
import { startWorker } from "./msw/worker"
import "../src/app/styles/globals.css"

const preview: Preview = {
  loaders: [mswLoader(startWorker)],
  decorators: [
    (Story, context) => {
      return (
        <LanguageProvider key={String(context.globals.language)} initialLanguage={context.globals.language === "en" ? "en" : "ru"}>
          <ThemeProvider
            key={context.id + String(context.globals.theme)}
            initialTheme={context.globals.theme === "dark" ? "dark" : "light"}
          >
            <QueryProvider>
              <SessionProvider>
                <Story />
              </SessionProvider>
            </QueryProvider>
          </ThemeProvider>
        </LanguageProvider>
      )
    },
  ],
  globalTypes: {
    language: { description: "Language", toolbar: { title: "Language", icon: "globe", items: ["ru", "en"] } },
    theme: { description: "Theme", toolbar: { title: "Theme", icon: "circlehollow", items: ["light", "dark"] } },
  },
  initialGlobals: { theme: "light", language: "ru" },
  parameters: { layout: "padded", a11y: { test: "error" } },
}

export default preview
