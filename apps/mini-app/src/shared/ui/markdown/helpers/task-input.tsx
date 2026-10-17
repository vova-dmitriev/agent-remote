import type { ComponentProps } from "react"
import { useTranslation } from "@/shared/lib/hooks"
import { MARKDOWN_IDS } from "../test-ids"

export function TaskInput({ checked }: ComponentProps<"input">) {
  const { t } = useTranslation()

  return (
    <input
      data-testid={MARKDOWN_IDS.taskInput}
      type="checkbox"
      checked={checked}
      disabled
      aria-label={t(checked ? "markdownTaskComplete" : "markdownTaskIncomplete")}
    />
  )
}
