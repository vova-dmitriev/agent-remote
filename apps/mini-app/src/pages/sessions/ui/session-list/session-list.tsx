import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { SessionsPageListProps } from "@/pages/sessions/ui/sessions-page.types"
import { SessionCards } from "./session-cards"
import { SessionListEmpty } from "./session-list-empty"
import { SessionPageStatus } from "./session-page-status"

export function SessionsPageList(props: SessionsPageListProps) {
  return (
    <div
      className="grid max-h-[70vh] gap-0 overflow-y-auto [scrollbar-gutter:stable]"
      data-testid={SESSIONS_PAGE_IDS.list}
      aria-busy={props.loading || props.pagesLoading}
      onScroll={(event) => {
        const node = event.currentTarget

        if (node.scrollHeight - node.scrollTop - node.clientHeight < 100) props.onLoadMore()
      }}
    >
      <SessionCards {...props} />
      <SessionListEmpty {...props} />
      <SessionPageStatus {...props} />
    </div>
  )
}
