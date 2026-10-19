import { MarkdownVariant } from "./constants/values"

export interface MarkdownProps {
  text: string
  variant?: MarkdownVariant
  className?: string
}
