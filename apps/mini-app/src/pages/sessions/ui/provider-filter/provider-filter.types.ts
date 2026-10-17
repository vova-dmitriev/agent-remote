import { ProviderFilterValue } from "@/pages/sessions/config/values"

export interface ProviderFilterProps {
  value: ProviderFilterValue
  onChange: (value: ProviderFilterValue) => void
}
