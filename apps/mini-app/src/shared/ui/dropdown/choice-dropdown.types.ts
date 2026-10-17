import type { LucideIcon } from "lucide-react"

interface ChoiceOption<Value extends string> {
  value: Value
  label: string
  description?: string
  icon?: LucideIcon
  testId: string
}

export interface ChoiceDropdownProps<Value extends string> {
  value: Value
  label: string
  triggerLabel: string
  icon: LucideIcon
  options: readonly ChoiceOption<Value>[]
  onChange: (value: Value) => void
  ids: { root: string; trigger: string; panel: string }
  compactIcon?: boolean
}
