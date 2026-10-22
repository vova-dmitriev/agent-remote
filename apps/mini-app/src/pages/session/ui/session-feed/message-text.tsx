import { ChevronDown, ChevronUp } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Markdown } from "@/shared/ui/markdown"
import { cn } from "@/shared/lib/utils"
import { useMessageFold } from "@/pages/session/model/message"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import type { MessageTextProps } from "@/pages/session/model/types/message-bubble.types"

/** A message's text; a long one folds to its first lines and unfolds again. */
export function MessageText({ id, text }: MessageTextProps) {
  const { t } = useTranslation()
  const fold = useMessageFold(id)
  const Icon = fold.collapsed ? ChevronDown : ChevronUp

  return (
    <>
      <div
        ref={fold.ref}
        className={cn(fold.collapsed && "max-h-[168px] overflow-hidden mask-[linear-gradient(to_bottom,black_55%,transparent)]")}
        data-testid={SESSION_FEED_IDS.text}
        data-collapsed={fold.collapsed || undefined}
      >
        <Markdown text={text} />
      </div>
      {fold.long ? (
        <button
          type="button"
          className="mt-[6px] inline-flex items-center gap-[4px] rounded-[6px] text-[12px] leading-[18px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={!fold.collapsed}
          data-testid={SESSION_FEED_IDS.fold}
          onClick={fold.toggle}
        >
          <Icon className="size-[14px]" aria-hidden />
          {t(fold.collapsed ? "expandMessage" : "collapseMessage")}
        </button>
      ) : null}
    </>
  )
}
