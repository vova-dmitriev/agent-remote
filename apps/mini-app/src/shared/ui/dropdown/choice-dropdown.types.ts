import type { LucideIcon } from "lucide-react"

interface ChoiceOption<Value extends string> {
  value: Value
  label: string
  description?: string
  icon?: LucideIcon
  testId: string
  /** Shown but not selectable, e.g. a previously chosen value that is no longer offered. */
  disabled?: boolean
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
  /** Hides the chevron on phones, where the header has no room to spare. */
  compactChevron?: boolean
  className?: string
  labelClassName?: string
  disabled?: boolean
}
