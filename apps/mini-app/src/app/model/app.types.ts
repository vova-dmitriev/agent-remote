import type { HostAdapter } from "@/shared/lib/host"
import type { Language } from "@/shared/lib/i18n"
import type { ProviderFilterValue } from "@protocol"

export interface AppProps {
  host?: HostAdapter
  initialLanguage?: Language
  initialProviderFilter?: ProviderFilterValue
}
