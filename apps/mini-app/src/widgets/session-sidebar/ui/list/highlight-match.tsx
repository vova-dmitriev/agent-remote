import { matchParts } from "@/widgets/session-sidebar/lib/sidebar-search"
import type { HighlightMatchProps } from "./list.types"

export function HighlightMatch({ text, query }: HighlightMatchProps) {
  return matchParts(text, query).map((part, index) =>
    part.match ? (
      <mark key={index} className="rounded-[3px] bg-primary/18 text-foreground underline decoration-primary/70 underline-offset-2">
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  )
}
