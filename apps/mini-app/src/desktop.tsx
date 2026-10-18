import { createRoot } from "react-dom/client"
import { z } from "zod"
import { App } from "@/app/app"
import { resolveLanguage } from "@/shared/lib/i18n"
import { createDesktopHost } from "@/shared/lib/host"
import "@/app/styles/globals.css"

z.config({ jitless: true })

const language = resolveLanguage(undefined, undefined, navigator.language)

document.documentElement.lang = language

createRoot(document.getElementById("root")!).render(<App host={createDesktopHost()} initialLanguage={language} />)
