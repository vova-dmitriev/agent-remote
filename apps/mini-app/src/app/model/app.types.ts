import type { ReactNode } from "react"
import type { HostAdapter } from "@/shared/lib/host"
import type { Language } from "@/shared/lib/i18n"
import type { ProviderFilterValue } from "@protocol"

export interface AppProps {
  /** Shown in place of the application, inside its providers (the extension's link screen). */
  content?: ReactNode
  host?: HostAdapter
  initialLanguage?: Language
  initialProviderFilter?: ProviderFilterValue
}
