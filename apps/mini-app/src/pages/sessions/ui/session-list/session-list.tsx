import { useEffect, useRef } from "react"
import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { SessionsPageListProps } from "@/pages/sessions/ui/sessions-page.types"
import { SessionCards } from "./session-cards"
import { SessionListEmpty } from "./session-list-empty"
import { SessionPageStatus } from "./session-page-status"

const LOAD_MORE_DISTANCE_PX = 100

export function SessionsPageList(props: SessionsPageListProps) {
  const list = useRef<HTMLDivElement>(null)

  const loadIfNearEnd = () => {
    const node = list.current

    if (node && node.scrollHeight - node.scrollTop - node.clientHeight < LOAD_MORE_DISTANCE_PX) props.onLoadMore()
  }

  // Collapsed groups can leave nothing to scroll, and older projects must still arrive. Runs after every render, so a
  // collapse counts too. A failed page waits for the retry button: retrying here would loop on every render.
  useEffect(() => {
    if (props.hasMore && !props.pagesLoading && !props.pagesFailed) loadIfNearEnd()
  })

  return (
    <div
      ref={list}
      className="grid max-h-[70vh] gap-0 overflow-y-auto [scrollbar-gutter:stable]"
      data-testid={SESSIONS_PAGE_IDS.list}
      aria-busy={props.loading || props.pagesLoading}
      onScroll={loadIfNearEnd}
    >
      <SessionCards {...props} />
      <SessionListEmpty {...props} />
      <SessionPageStatus {...props} />
    </div>
  )
}
