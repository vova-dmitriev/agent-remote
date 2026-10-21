import { useTranslation } from "@/shared/lib/hooks"
import { SidebarGroups } from "./groups/sidebar-groups"
import { SidebarEmptyState } from "./empty/sidebar-empty-state"
import { SidebarPageStatus } from "./empty/sidebar-page-status"
import type { SidebarListProps } from "./list.types"

export function SidebarList(props: SidebarListProps) {
  const { sections, query } = props
  const { t } = useTranslation()

  if (!sections.length) {
    return (
      <>
        <SidebarEmptyState query={query} onClear={props.onClear} />
        <SidebarPageStatus loading={!!props.pagesLoading} failed={!!props.pagesFailed} onRetry={props.onRetryPages} />
      </>
    )
  }

  return (
    <>
      <SidebarGroups {...props} label={t("sidebarSessions")} />
      <SidebarPageStatus loading={!!props.pagesLoading} failed={!!props.pagesFailed} onRetry={props.onRetryPages} />
    </>
  )
}
